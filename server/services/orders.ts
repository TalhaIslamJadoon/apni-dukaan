// Order service — the single transactional checkout path (plan §1.1, §6
// Step 2). One transaction: validate → lock inventory → allocate bill/token
// → insert order+lines+bill → decrement stock → Udhaar charge → outbox +
// audit → commit. clientRequestId makes every submission idempotent.
import type { PoolClient } from "pg";
import crypto from "node:crypto";
import { tx, one, ApiError, businessDate, paisa } from "../db";
import { emit, audit } from "../events";
import { fetchOrderDTOById, shopIdByKind } from "../dto";
import type { StaffPrincipal, CustomerPrincipal } from "../auth";

export interface Actor {
  type: "staff" | "customer" | "public";
  staff?: StaffPrincipal;
  customer?: CustomerPrincipal;
}

export interface CreateOrderInput {
  clientRequestId: string;
  shopKind: "canteen" | "grocery";
  source: "counter" | "table_qr" | "remote_online";
  lines: { itemId: string; qty: number; packingLabel?: string; variantName?: string; serials?: string[] }[];
  priceType?: "retail" | "wholesale";
  discount?: number; // Rs
  payment: string; // Phase 1 label: Cash | JazzCash | Easypaisa | Udhaar | Online | Counter
  tendered?: number; // Rs
  udhaarName?: string;
  udhaarExternalId?: string;
  orderType?: "dine-in" | "takeaway";
  tableNo?: number;
  customerName?: string;
  placeLabel?: string;
  paymentProof?: { method: string; txnId?: string; amount: number; proofImage: string };
}

const WALLET_METHOD: Record<string, string> = { JazzCash: "jazzcash", Easypaisa: "easypaisa", Raast: "raast" };

async function nextCounter(c: PoolClient, key: string): Promise<number> {
  const r = await c.query(
    `INSERT INTO document_counters (counter_key, next_value) VALUES ($1, 2)
     ON CONFLICT (counter_key) DO UPDATE SET next_value = document_counters.next_value + 1, updated_at = now()
     RETURNING next_value - 1 AS v`,
    [key]
  );
  return r.rows[0].v as number;
}

interface ResolvedLine {
  kind: "menu_item" | "grocery_product" | "deal";
  menuItemId?: string;
  productId?: string;
  variantId?: string;
  packingId?: string;
  dealId?: string;
  inventoryId: string; // "" for deal lines — their stock lives on the components
  name: string;
  variantName?: string;
  packingLabel?: string;
  unit: string;
  qty: number;
  containsQty: number; // base pieces per sold unit (packing contains_qty; 1 = Phase 1 behaviour)
  unitPricePaisa: number;
  packingStockTracked: boolean;
  wholesaleMin?: number; // effective wholesale minimum for this line (grocery)
  isOffer?: boolean; // grocery retail line charged at the product's active offer price
  serials?: string[]; // IMEI/serial numbers captured at sale (mobile shops)
  // Deal lines: order-time component snapshot (client shape {itemId, name,
  // qty} — itemId is the menu legacy id) + the server-side stock expansion.
  components?: { itemId: string; name: string; qty: number }[];
  componentStock?: { inventoryId: string; qtyPerDeal: number }[];
}

export async function createOrder(input: CreateOrderInput, actor: Actor): Promise<{ order: Record<string, unknown>; accessToken?: string; replay?: boolean }> {
  if (!input.clientRequestId) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "clientRequestId zaroori hai");
  // client_request_id column uuid type ki hai — UUID-shaped na ho to
  // deterministic uuid bana lein (same key → same uuid → idempotency
  // barqarar), warna Postgres uuid parse error se poora order 500 hota tha.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.clientRequestId)) {
    const h = crypto.createHash("sha256").update(`idem:${input.clientRequestId}`).digest("hex");
    input.clientRequestId = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }
  const existing = await one<{ id: string }>("SELECT id FROM orders WHERE client_request_id = $1", [input.clientRequestId]);
  if (existing) {
    return { order: (await fetchOrderDTOById(existing.id))!, replay: true };
  }
  if (!input.lines?.length) throw new ApiError(400, "EMPTY_ORDER", "Order mein koi item nahi hai");

  // Account verification gate (Talha, 15 Nov 2026): a remote customer
  // whose EMAIL code is still unconfirmed cannot order. The account can
  // log in (and sees the verification screen), but ordering stays blocked
  // server-side until verifyCode flips email_verified.
  if (actor.type === "customer" && !actor.customer!.emailVerified) {
    throw new ApiError(403, "EMAIL_NOT_VERIFIED", "Pehle apna email confirm karein — baghair email confirmation ke order nahi ho sakta");
  }

  const shopId = await shopIdByKind(input.shopKind);
  const bDate = businessDate();
  const proofFlow = !!input.paymentProof;
  const priceType = input.shopKind === "grocery" && actor.type === "staff" && input.priceType === "wholesale" ? "wholesale" : "retail";
  const settingsRow = await one<any>("SELECT wholesale_min_pieces, wholesale_min_kg FROM system_settings WHERE id = true");
  const wholesaleDefaults = {
    pieces: Number(settingsRow?.wholesale_min_pieces ?? 10),
    kg: Number(settingsRow?.wholesale_min_kg ?? 5),
  };

  // Udhaar identity rules (plan §1.3): remote customer needs a saved ID;
  // a table guest must supply an ID at order time.
  if (input.payment === "Udhaar") {
    if (actor.type === "customer" && !actor.customer!.externalId && !input.udhaarExternalId) {
      throw new ApiError(400, "UDHAAR_ID_REQUIRED", "Udhaar ke liye pehle account mein student/staff ID save karein");
    }
    if (actor.type === "public" && !input.udhaarExternalId) {
      throw new ApiError(400, "UDHAAR_ID_REQUIRED", "Udhaar ke liye student/staff ID zaroori hai");
    }
  }

  const txResult = await tx(async (c) => {
    // Re-check idempotency inside the transaction (concurrent double submit).
    const dup = await c.query("SELECT id FROM orders WHERE client_request_id = $1", [input.clientRequestId]);
    if (dup.rows[0]) return { order: (await fetchOrderDTOById(dup.rows[0].id))!, replay: true };

    // ── Resolve lines against DATABASE prices (client prices never trusted)
    const resolved: ResolvedLine[] = [];
    for (const line of input.lines) {
      if (!(line.qty > 0)) throw new ApiError(400, "BAD_QUANTITY", "Quantity ghalat hai");
      if (input.shopKind === "canteen" && line.itemId.startsWith("deal:")) {
        // ── Deal line: ONE order line at the DEAL price; the components
        // snapshot is frozen onto the line and stock expands into the
        // component menu items (Phase 1 dealOrderLine semantics).
        const dealKey = line.itemId.slice("deal:".length);
        const dr = await c.query("SELECT * FROM deals WHERE (legacy_id = $1 OR id::text = $1) AND is_active = true", [dealKey]);
        const d = dr.rows[0];
        if (!d) throw new ApiError(400, "DEAL_NOT_FOUND", `Deal nahi mili ya band hai: ${dealKey}`);
        const comps = await c.query(
          `SELECT di.qty, mi.id AS mid, mi.legacy_id, mi.name, b.id AS inv_id
           FROM deal_items di
           JOIN menu_items mi ON mi.id = di.menu_item_id
           LEFT JOIN inventory_balances b ON b.menu_item_id = mi.id
           WHERE di.deal_id = $1 ORDER BY di.sort_order`,
          [d.id]
        );
        if (!comps.rows.length) throw new ApiError(400, "DEAL_EMPTY", "Deal mein koi item nahi hai");
        resolved.push({
          kind: "deal", dealId: d.id, inventoryId: "",
          name: `🎁 ${d.name}`, unit: "piece", qty: line.qty, containsQty: 1,
          unitPricePaisa: d.price_paisa, packingStockTracked: false,
          components: comps.rows.map((r: any) => ({ itemId: r.legacy_id ?? r.mid, name: r.name, qty: Number(r.qty) })),
          componentStock: comps.rows.map((r: any) => ({ inventoryId: r.inv_id, qtyPerDeal: Number(r.qty) })),
        });
      } else if (input.shopKind === "canteen") {
        const r = await c.query(
          `SELECT m.*, b.id AS inv_id FROM menu_items m
           LEFT JOIN inventory_balances b ON b.menu_item_id = m.id
           WHERE (m.legacy_id = $1 OR m.id::text = $1) AND m.is_active = true`,
          [line.itemId]
        );
        const m = r.rows[0];
        if (!m) throw new ApiError(400, "ITEM_NOT_FOUND", `Menu item nahi mila: ${line.itemId}`);
        resolved.push({
          kind: "menu_item", menuItemId: m.id, inventoryId: m.inv_id, name: m.name,
          unit: "piece", qty: line.qty, containsQty: 1, unitPricePaisa: m.price_paisa, packingStockTracked: false,
        });
      } else {
        const r = await c.query(
          `SELECT p.*, b.id AS inv_id FROM grocery_products p
           LEFT JOIN inventory_balances b ON b.grocery_product_id = p.id
           WHERE (p.legacy_id = $1 OR p.id::text = $1) AND p.is_active = true`,
          [line.itemId]
        );
        const p = r.rows[0];
        if (!p) throw new ApiError(400, "ITEM_NOT_FOUND", `Product nahi mila: ${line.itemId}`);
        // Variant: named variant if requested, else the implicit Standard.
        let variant = null as any;
        if (line.variantName) {
          const vr = await c.query("SELECT * FROM grocery_variants WHERE product_id = $1 AND lower(name) = lower($2) AND is_active = true", [p.id, line.variantName]);
          variant = vr.rows[0] ?? null;
          if (!variant) throw new ApiError(400, "VARIANT_NOT_FOUND", `Variant nahi mila: ${line.variantName}`);
        } else {
          const vr = await c.query("SELECT * FROM grocery_variants WHERE product_id = $1 AND is_active = true ORDER BY (name = 'Standard') DESC, sort_order LIMIT 1", [p.id]);
          variant = vr.rows[0] ?? null;
        }
        let packing = null as any;
        if (line.packingLabel && variant) {
          const pr = await c.query("SELECT * FROM grocery_packings WHERE variant_id = $1 AND lower(label) = lower($2) AND is_active = true", [variant.id, line.packingLabel]);
          packing = pr.rows[0] ?? null;
          if (!packing && !line.variantName) {
            // The parenthetical may be a VARIANT name (line sold by variant,
            // no packing): re-resolve the variant and sell its base price.
            const vr = await c.query("SELECT * FROM grocery_variants WHERE product_id = $1 AND lower(name) = lower($2) AND is_active = true", [p.id, line.packingLabel]);
            if (vr.rows[0]) variant = vr.rows[0];
            else throw new ApiError(400, "PACKING_NOT_FOUND", `Packing nahi mili: ${line.packingLabel}`);
          }
          if (!packing && line.variantName) throw new ApiError(400, "PACKING_NOT_FOUND", `Packing nahi mili: ${line.packingLabel}`);
        }
        let unitPrice = packing
          ? (priceType === "wholesale" ? packing.wholesale_price_paisa : packing.retail_price_paisa)
          : (priceType === "wholesale" ? p.wholesale_price_paisa : p.retail_price_paisa);
        // ── Offer price (Phase 1 offerActive/effectiveRetail, server-side):
        // ACTIVE only when the product is board-flagged AND 0 < offer <
        // base retail. It replaces ONLY the representative retail price —
        // a base (no-packing) sale, or the one packing priced exactly at
        // the base retail (catalogue construction guarantees at most one).
        // The SERVER charges it; client-sent prices are never trusted.
        // Wholesale is never touched.
        let isOffer = false;
        if (
          priceType === "retail" && p.board_offer &&
          p.offer_price_paisa !== null && p.offer_price_paisa !== undefined &&
          Number(p.offer_price_paisa) > 0 && Number(p.offer_price_paisa) < Number(p.retail_price_paisa) &&
          (!packing || Number(packing.retail_price_paisa) === Number(p.retail_price_paisa))
        ) {
          unitPrice = Number(p.offer_price_paisa);
          isOffer = true;
        }
        // Effective wholesale minimum: packing min (packs) → product min → shop default.
        const effMin = packing
          ? Number(packing.wholesale_min_qty ?? p.wholesale_min_qty ?? wholesaleDefaults.pieces)
          : Number(p.wholesale_min_qty ?? (p.unit === "kg" ? wholesaleDefaults.kg : wholesaleDefaults.pieces));
        resolved.push({
          kind: "grocery_product", productId: p.id, variantId: variant?.id, packingId: packing?.id,
          inventoryId: p.inv_id, name: p.name, variantName: variant?.name,
          packingLabel: packing?.label, unit: p.unit, qty: line.qty,
          containsQty: packing ? Number(packing.contains_qty ?? 1) : 1,
          unitPricePaisa: unitPrice,
          packingStockTracked: !!packing && packing.stock_qty !== null,
          wholesaleMin: effMin,
          isOffer,
          serials: line.serials?.length ? line.serials.map((s) => String(s)) : undefined,
        });
        if (packing && packing.stock_qty !== null && Number(packing.stock_qty) < line.qty) {
          throw new ApiError(409, "INSUFFICIENT_STOCK", `${p.name} (${packing.label}) ka stock kam hai`, { availableQty: Number(packing.stock_qty) });
        }
      }
    }

    // ── Wholesale minimum-quantity rule (server-enforced, not just UI):
    // in wholesale mode a bill line below its effective minimum refuses the
    // whole bill. Retail mode is unaffected.
    if (priceType === "wholesale") {
      for (const r of resolved) {
        // Contribution is counted in BASE pieces: a Full Box line counts
        // contains_qty × qty toward the minimum.
        const contribution = r.qty * r.containsQty;
        if (r.wholesaleMin !== undefined && contribution < r.wholesaleMin) {
          throw new ApiError(400, "WHOLESALE_MIN_QTY",
            `Wholesale ke liye kam az kam ${r.wholesaleMin} lazmi hai (${r.name})`,
            { product: r.name, min: r.wholesaleMin, qty: r.qty, contribution });
        }
      }
    }

    // ── Lock inventory rows and check stock (never negative, plan §7)
    const need = new Map<string, number>();
    // Inventory is one pool of BASE pieces for packing products: a box sale
    // needs contains_qty × qty pieces, a single needs 1 × qty. A DEAL line
    // needs each component's qty × deal qty from the component's own pool.
    for (const r of resolved) {
      if (r.kind === "deal") {
        for (const comp of r.componentStock ?? []) {
          if (comp.inventoryId) need.set(comp.inventoryId, (need.get(comp.inventoryId) ?? 0) + comp.qtyPerDeal * r.qty);
        }
      } else if (r.inventoryId) {
        need.set(r.inventoryId, (need.get(r.inventoryId) ?? 0) + r.qty * r.containsQty);
      }
    }
    const invIds = [...need.keys()];
    const invRows = new Map<string, any>();
    if (invIds.length) {
      const locked = await c.query("SELECT * FROM inventory_balances WHERE id = ANY($1) FOR UPDATE", [invIds]);
      for (const row of locked.rows) invRows.set(row.id, row);
    }
    for (const [invId, qty] of need) {
      const bal = invRows.get(invId);
      if (!bal) throw new ApiError(500, "INVENTORY_MISSING", "Inventory row missing hai");
      if (Number(bal.quantity_on_hand) < qty) {
        throw new ApiError(409, "INSUFFICIENT_STOCK", "Stock kam hai", { availableQty: Number(bal.quantity_on_hand) });
      }
    }

    // ── Totals (server-calculated)
    let subtotal = 0;
    for (const r of resolved) subtotal += Math.round(r.qty * r.unitPricePaisa);
    const lineTotals = resolved.map((r) => Math.round(r.qty * r.unitPricePaisa));
    const discountPaisa = Math.min(Math.max(paisa(input.discount ?? 0), 0), subtotal);
    const total = subtotal - discountPaisa;

    // ── Numbers: bill always; token only when payment is cleared at placement
    const billSeq = await nextCounter(c, "bill");
    const billNo = `B-${String(billSeq).padStart(4, "0")}`;
    // Per-shop token (Talha, 15 Nov 2026): har dukaan ki apni daily counting.
    const tokenNo = proofFlow ? null : await nextCounter(c, `token:${shopId}:${bDate}`);

    // ── Table session (dine-in)
    let tableId: string | null = null;
    let sessionId: string | null = null;
    if (input.source === "table_qr" && input.orderType === "dine-in" && input.tableNo) {
      const tr = await c.query("SELECT * FROM dining_tables WHERE shop_id = $1 AND table_no = $2 AND is_active = true", [shopId, input.tableNo]);
      const table = tr.rows[0];
      if (!table) throw new ApiError(400, "TABLE_NOT_FOUND", "Table nahi mila");
      tableId = table.id;
      const sr = await c.query("SELECT * FROM table_sessions WHERE table_id = $1 AND status = 'open'", [table.id]);
      if (sr.rows[0]) sessionId = sr.rows[0].id;
      else {
        const ins = await c.query(
          "INSERT INTO table_sessions (shop_id, table_id, guest_name, opened_by_staff_id) VALUES ($1,$2,$3,$4) RETURNING id",
          [shopId, table.id, input.customerName ?? null, actor.staff?.id ?? null]
        );
        sessionId = ins.rows[0].id;
      }
    } else if (input.tableNo) {
      const tr = await c.query("SELECT id FROM dining_tables WHERE shop_id = $1 AND table_no = $2", [shopId, input.tableNo]);
      tableId = tr.rows[0]?.id ?? null;
    }

    const accessToken = actor.type === "public" ? crypto.randomBytes(24).toString("hex") : null;
    const accessHash = accessToken ? crypto.createHash("sha256").update(accessToken).digest("hex") : null;

    const initialStatus = input.shopKind === "grocery" && input.source === "counter" ? "ready" : "received";
    const ord = await c.query(
      `INSERT INTO orders (client_request_id, shop_id, business_date, token_no, source, fulfilment_type, status,
         price_type, table_session_id, table_id, customer_id, customer_name_snapshot, customer_mobile_snapshot,
         customer_external_id_snapshot, place_label_snapshot, access_token_hash, cashier_staff_id, created_by_type,
         subtotal_paisa, discount_paisa, total_paisa, payment_method, tendered_paisa, change_paisa,
         payment_status, proof_method, proof_txn_ref, proof_amount_paisa, proof_image, proof_uploaded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
       RETURNING id`,
      [
        input.clientRequestId, shopId, bDate, tokenNo, input.source,
        input.source === "counter" ? "counter" : input.source === "table_qr" ? (input.orderType === "dine-in" ? "dine_in" : "takeaway") : "pickup",
        initialStatus, priceType, sessionId, tableId,
        actor.customer?.id ?? null,
        input.customerName ?? actor.customer?.name ?? (input.payment === "Udhaar" ? input.udhaarName ?? null : null),
        actor.customer?.mobile ?? null,
        input.udhaarExternalId ?? actor.customer?.externalId ?? null,
        input.placeLabel ?? (actor.customer ? `${actor.customer.placeType} ${actor.customer.placeDetail}`.trim() : null),
        accessHash,
        actor.staff?.id ?? null,
        actor.type === "staff" ? "staff" : actor.type === "customer" ? "customer" : "customer",
        subtotal, discountPaisa, total, input.payment,
        input.tendered !== undefined ? paisa(input.tendered) : null,
        input.payment === "Cash" && input.tendered !== undefined ? Math.max(0, paisa(input.tendered) - total) : null,
        proofFlow ? "proof_pending" : null,
        proofFlow ? input.paymentProof!.method : null,
        proofFlow ? input.paymentProof!.txnId ?? null : null,
        proofFlow ? paisa(input.paymentProof!.amount) : null,
        proofFlow ? input.paymentProof!.proofImage : null,
        proofFlow ? new Date() : null,
      ]
    );
    const orderId = ord.rows[0].id as string;

    const lineIds: string[] = [];
    for (let i = 0; i < resolved.length; i++) {
      const r = resolved[i];
      const lr = await c.query(
        `INSERT INTO order_lines (order_id, line_no, item_kind, menu_item_id, grocery_product_id, grocery_variant_id,
           grocery_packing_id, deal_id, components, serials, item_name_snapshot, variant_name_snapshot, packing_label_snapshot, unit_snapshot,
           quantity, contains_qty_snapshot, unit_price_paisa, line_total_paisa, is_offer)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
        [orderId, i + 1, r.kind, r.menuItemId ?? null, r.productId ?? null, r.variantId ?? null, r.packingId ?? null,
         r.dealId ?? null,
         r.components ? JSON.stringify(r.components) : null,
         r.serials ? JSON.stringify(r.serials) : null,
         r.name, r.variantName ?? null, r.packingLabel ?? null, r.unit, r.qty, r.containsQty, r.unitPricePaisa, lineTotals[i], !!r.isOffer]
      );
      lineIds.push(lr.rows[0].id);
    }
    await c.query(
      "INSERT INTO order_status_history (order_id, from_status, to_status, actor_type, actor_staff_id, actor_customer_id) VALUES ($1,NULL,$2,$3,$4,$5)",
      [orderId, initialStatus, actor.type === "staff" ? "staff" : "customer", actor.staff?.id ?? null, actor.customer?.id ?? null]
    );

    // ── Stock decrement (exactly once per line+inventory — guarded by the
    // unique index). Movement is in BASE pieces: qty × contains_qty per
    // line; a deal line moves each component's pool by qtyPerDeal × qty.
    const afterByInv = new Map<string, number>();
    for (const [invId, qty] of need) {
      const after = Number(invRows.get(invId).quantity_on_hand) - qty;
      afterByInv.set(invId, after);
      await c.query("UPDATE inventory_balances SET quantity_on_hand = $2, version = version + 1, updated_at = now() WHERE id = $1", [invId, after]);
    }
    for (let i = 0; i < resolved.length; i++) {
      const r = resolved[i];
      if (r.kind === "deal") {
        for (const comp of r.componentStock ?? []) {
          if (!comp.inventoryId) continue;
          await c.query(
            `INSERT INTO stock_entries (inventory_id, entry_type, qty_delta, qty_after, order_line_id, created_by_staff_id)
             VALUES ($1,'sale',$2,$3,$4,$5)`,
            [comp.inventoryId, -(comp.qtyPerDeal * r.qty), afterByInv.get(comp.inventoryId), lineIds[i], actor.staff?.id ?? null]
          );
        }
        continue;
      }
      await c.query(
        `INSERT INTO stock_entries (inventory_id, entry_type, qty_delta, qty_after, order_line_id, created_by_staff_id)
         VALUES ($1,'sale',$2,$3,$4,$5)`,
        [r.inventoryId, -(r.qty * r.containsQty), afterByInv.get(r.inventoryId), lineIds[i], actor.staff?.id ?? null]
      );
      if (r.packingStockTracked && r.packingId) {
        await c.query("UPDATE grocery_packings SET stock_qty = stock_qty - $2, updated_at = now() WHERE id = $1", [r.packingId, r.qty]);
      }
    }

    // ── Bill + payments
    const billStatus = input.payment === "Udhaar" ? "settled_on_credit" : "settled";
    const bill = await c.query(
      `INSERT INTO bills (bill_no, shop_id, status, subtotal_paisa, discount_paisa, total_paisa,
         amount_tendered_paisa, amount_on_udhaar_paisa, change_paisa, created_by_staff_id, settled_by_staff_id, settled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10, now()) RETURNING id`,
      [billNo, shopId, billStatus, subtotal, discountPaisa, total,
       input.payment === "Udhaar" ? 0 : total, input.payment === "Udhaar" ? total : 0,
       input.payment === "Cash" && input.tendered !== undefined ? Math.max(0, paisa(input.tendered) - total) : 0,
       actor.staff?.id ?? null]
    );
    const billId = bill.rows[0].id as string;
    await c.query("INSERT INTO bill_orders (bill_id, order_id) VALUES ($1,$2)", [billId, orderId]);

    if (proofFlow) {
      await c.query(
        `INSERT INTO payments (bill_id, payment_kind, method, amount_paisa, status, provider_reference)
         VALUES ($1,'tender',$2,$3,'pending_confirmation',$4)`,
        [billId, (WALLET_METHOD[input.paymentProof!.method] ?? "other"), paisa(input.paymentProof!.amount), input.paymentProof!.txnId ?? null]
      );
    } else if (input.payment === "Udhaar") {
      const extId = input.udhaarExternalId ?? actor.customer?.externalId ?? null;
      const dispName = input.udhaarName ?? input.customerName ?? actor.customer?.name ?? "Udhaar Customer";
      const identityKey = extId ? `ext:${extId.trim().toLowerCase()}` : `name:${dispName.trim().toLowerCase()}|${actor.customer?.mobile ?? ""}`;
      let acc = (await c.query("SELECT * FROM udhaar_accounts WHERE identity_key = $1 FOR UPDATE", [identityKey])).rows[0];
      if (!acc) {
        acc = (await c.query(
          "INSERT INTO udhaar_accounts (customer_id, external_id, display_name, mobile, identity_key) VALUES ($1,$2,$3,$4,$5) RETURNING *",
          [actor.customer?.id ?? null, extId, dispName, actor.customer?.mobile ?? null, identityKey]
        )).rows[0];
      }
      const pay = await c.query(
        "INSERT INTO payments (bill_id, udhaar_account_id, payment_kind, method, amount_paisa, status) VALUES ($1,$2,'udhaar_charge','udhaar',$3,'confirmed') RETURNING id",
        [billId, acc.id, total]
      );
      const bal = (await c.query("SELECT COALESCE(SUM(amount_paisa),0) AS b FROM udhaar_ledger_entries WHERE udhaar_account_id = $1", [acc.id])).rows[0].b;
      await c.query(
        "INSERT INTO udhaar_ledger_entries (udhaar_account_id, entry_type, amount_paisa, balance_after_paisa, bill_id, payment_id, created_by_staff_id) VALUES ($1,'charge',$2,$3,$4,$5,$6)",
        [acc.id, total, Number(bal) + total, billId, pay.rows[0].id, actor.staff?.id ?? null]
      );
    } else if (total > 0) {
      await c.query(
        "INSERT INTO payments (bill_id, payment_kind, method, amount_paisa, status, confirmed_by_staff_id, confirmed_at) VALUES ($1,'tender',$2,$3,'confirmed',$4, now())",
        [billId, WALLET_METHOD[input.payment] ?? "cash", total, actor.staff?.id ?? null]
      );
    }

    await audit(c, { type: actor.type === "staff" ? "staff" : "customer", staffId: actor.staff?.id, customerId: actor.customer?.id },
      "order.create", "order", orderId, { billNo, total, source: input.source });
    await emit(c, "order.created", "order", orderId, { shopId, payload: { orderId, status: initialStatus, paymentStatus: proofFlow ? "proof_pending" : undefined } });
    await emit(c, "stock.changed", "inventory", null, { shopId });
    await emit(c, "dashboard.changed", "dashboard", null, { shopId });

    return { orderId, accessToken: accessToken ?? undefined };
  });
  if ("order" in txResult && txResult.order) return txResult as { order: Record<string, unknown>; replay: boolean }; // in-tx idempotent replay
  // Fetch the DTO AFTER commit: inside the transaction the pool connection
  // cannot see the uncommitted order (it would return null).
  const dto = await fetchOrderDTOById(txResult.orderId);
  return { order: dto!, accessToken: txResult.accessToken };
}

// ── Status transitions ───────────────────────────────────────────────────────
const TRANSITIONS: Record<string, string[]> = {
  received: ["preparing", "ready", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["completed"],
  completed: [],
  cancelled: [],
};

export async function updateOrderStatus(orderId: string, toUiStatus: string, actor: Actor): Promise<Record<string, unknown>> {
  const to = toUiStatus === "pending" ? "received" : toUiStatus;
  await tx(async (c) => {
    const r = await c.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    const o = r.rows[0];
    if (!o) throw new ApiError(404, "ORDER_NOT_FOUND", "Order nahi mila");
    if (o.status === to) return; // stale double tap → current state (fetched after commit below)
    if (!TRANSITIONS[o.status]?.includes(to)) {
      throw new ApiError(409, "BAD_TRANSITION", `Order ${o.status} se ${to} nahi ho sakta`);
    }
    if (to === "cancelled") {
      await restoreStock(c, o, actor);
    }
    await c.query(
      `UPDATE orders SET status = $2, updated_at = now(),
         ready_at = CASE WHEN $2 = 'ready' THEN now() ELSE ready_at END,
         completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE completed_at END,
         cancelled_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE cancelled_at END,
         version = version + 1 WHERE id = $1`,
      [orderId, to]
    );
    await c.query(
      "INSERT INTO order_status_history (order_id, from_status, to_status, actor_type, actor_staff_id, actor_customer_id) VALUES ($1,$2,$3,$4,$5,$6)",
      [orderId, o.status, to, actor.type === "staff" ? "staff" : "customer", actor.staff?.id ?? null, actor.customer?.id ?? null]
    );
    await emit(c, "order.status_changed", "order", orderId, { shopId: o.shop_id, payload: { orderId, status: to } });
    await audit(c, { type: actor.type === "staff" ? "staff" : "customer", staffId: actor.staff?.id, customerId: actor.customer?.id },
      "order.status", "order", orderId, { status: to }, { status: o.status });
  });
  return (await fetchOrderDTOById(orderId))!;
}

async function restoreStock(c: PoolClient, order: any, actor: Actor): Promise<void> {
  const lines = await c.query("SELECT * FROM order_lines WHERE order_id = $1", [order.id]);
  for (const l of lines.rows) {
    if (l.item_kind === "deal") {
      // Deal line: give every component's stock back (snapshot quantities).
      const comps = (l.components ?? []) as { itemId: string; qty: number }[];
      for (const comp of comps) {
        const inv = await c.query(
          `SELECT b.id FROM inventory_balances b JOIN menu_items m ON m.id = b.menu_item_id
           WHERE m.legacy_id = $1 OR m.id::text = $1`,
          [comp.itemId]
        );
        const invId = inv.rows[0]?.id;
        if (!invId) continue;
        const baseQty = comp.qty * Number(l.quantity);
        const upd = await c.query(
          "UPDATE inventory_balances SET quantity_on_hand = quantity_on_hand + $2, version = version + 1, updated_at = now() WHERE id = $1 RETURNING quantity_on_hand",
          [invId, baseQty]
        );
        await c.query(
          "INSERT INTO stock_entries (inventory_id, entry_type, qty_delta, qty_after, order_line_id, created_by_staff_id) VALUES ($1,'sale_reversal',$2,$3,$4,$5)",
          [invId, baseQty, Number(upd.rows[0].quantity_on_hand), l.id, actor.staff?.id ?? null]
        );
      }
      continue;
    }
    const inv = await c.query(
      `SELECT id FROM inventory_balances WHERE menu_item_id IS NOT DISTINCT FROM $1 AND grocery_product_id IS NOT DISTINCT FROM $2`,
      [l.menu_item_id, l.grocery_product_id]
    );
    const invId = inv.rows[0]?.id;
    if (!invId) continue;
    const baseQty = Number(l.quantity) * Number(l.contains_qty_snapshot ?? 1);
    const upd = await c.query(
      "UPDATE inventory_balances SET quantity_on_hand = quantity_on_hand + $2, version = version + 1, updated_at = now() WHERE id = $1 RETURNING quantity_on_hand",
      [invId, baseQty]
    );
    await c.query(
      "INSERT INTO stock_entries (inventory_id, entry_type, qty_delta, qty_after, order_line_id, created_by_staff_id) VALUES ($1,'sale_reversal',$2,$3,$4,$5)",
      [invId, baseQty, Number(upd.rows[0].quantity_on_hand), l.id, actor.staff?.id ?? null]
    );
    if (l.grocery_packing_id) {
      await c.query("UPDATE grocery_packings SET stock_qty = stock_qty + $2 WHERE id = $1 AND stock_qty IS NOT NULL", [l.grocery_packing_id, Number(l.quantity)]);
    }
  }
}

async function deductStockAgain(c: PoolClient, order: any, actor: Actor): Promise<void> {
  const lines = await c.query("SELECT * FROM order_lines WHERE order_id = $1", [order.id]);
  for (const l of lines.rows) {
    if (l.item_kind === "deal") {
      // Deal line: re-deduct every component (rejection had restored them).
      const comps = (l.components ?? []) as { itemId: string; qty: number }[];
      for (const comp of comps) {
        const inv = await c.query(
          `SELECT b.* FROM inventory_balances b JOIN menu_items m ON m.id = b.menu_item_id
           WHERE m.legacy_id = $1 OR m.id::text = $1 FOR UPDATE OF b`,
          [comp.itemId]
        );
        const bal = inv.rows[0];
        if (!bal) continue;
        const baseQty = comp.qty * Number(l.quantity);
        if (Number(bal.quantity_on_hand) < baseQty) {
          throw new ApiError(409, "INSUFFICIENT_STOCK", "Dobara proof par stock kam hai", { availableQty: Number(bal.quantity_on_hand) });
        }
        const upd = await c.query(
          "UPDATE inventory_balances SET quantity_on_hand = quantity_on_hand - $2, version = version + 1, updated_at = now() WHERE id = $1 RETURNING quantity_on_hand",
          [bal.id, baseQty]
        );
        await c.query(
          "INSERT INTO stock_entries (inventory_id, entry_type, qty_delta, qty_after, order_line_id, note, created_by_staff_id) VALUES ($1,'adjustment',$2,$3,$4,'Re-proof re-deduction (deal component)',$5)",
          [bal.id, -baseQty, Number(upd.rows[0].quantity_on_hand), l.id, actor.staff?.id ?? null]
        );
      }
      continue;
    }
    const inv = await c.query(
      `SELECT * FROM inventory_balances WHERE menu_item_id IS NOT DISTINCT FROM $1 AND grocery_product_id IS NOT DISTINCT FROM $2 FOR UPDATE`,
      [l.menu_item_id, l.grocery_product_id]
    );
    const bal = inv.rows[0];
    if (!bal) continue;
    const baseQty = Number(l.quantity) * Number(l.contains_qty_snapshot ?? 1);
    if (Number(bal.quantity_on_hand) < baseQty) {
      throw new ApiError(409, "INSUFFICIENT_STOCK", "Dobara proof par stock kam hai", { availableQty: Number(bal.quantity_on_hand) });
    }
    const upd = await c.query(
      "UPDATE inventory_balances SET quantity_on_hand = quantity_on_hand - $2, version = version + 1, updated_at = now() WHERE id = $1 RETURNING quantity_on_hand",
      [bal.id, baseQty]
    );
    // 'sale' already has its one entry per line (unique index) from placement;
    // the re-deduction is ledgered as an adjustment so the books stay complete.
    await c.query(
      "INSERT INTO stock_entries (inventory_id, entry_type, qty_delta, qty_after, order_line_id, note, created_by_staff_id) VALUES ($1,'adjustment',$2,$3,$4,'Re-proof re-deduction',$5)",
      [bal.id, -baseQty, Number(upd.rows[0].quantity_on_hand), l.id, actor.staff?.id ?? null]
    );
    if (l.grocery_packing_id) {
      await c.query("UPDATE grocery_packings SET stock_qty = stock_qty - $2 WHERE id = $1 AND stock_qty IS NOT NULL", [l.grocery_packing_id, Number(l.quantity)]);
    }
  }
}

// ── Payment-proof verification ───────────────────────────────────────────────
export async function confirmPayment(orderId: string, staff: StaffPrincipal): Promise<Record<string, unknown>> {
  await tx(async (c) => {
    const r = await c.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    const o = r.rows[0];
    if (!o) throw new ApiError(404, "ORDER_NOT_FOUND", "Order nahi mila");
    if (o.payment_status !== "proof_pending") throw new ApiError(409, "NOT_PENDING", "Ye order tasdeeq ke liye pending nahi hai");
    let token = o.token_no as number | null;
    // Confirm-time token comes from the ORDER's OWN shop sequence.
    if (token === null) token = await nextCounter(c, `token:${o.shop_id}:${businessDate()}`);
    await c.query("UPDATE orders SET payment_status = 'confirmed', token_no = $2, updated_at = now(), version = version + 1 WHERE id = $1", [orderId, token]);
    await c.query(
      `UPDATE payments SET status = 'confirmed', confirmed_by_staff_id = $2, confirmed_at = now()
       WHERE bill_id IN (SELECT bill_id FROM bill_orders WHERE order_id = $1) AND status = 'pending_confirmation'`,
      [orderId, staff.id]
    );
    await emit(c, "order.payment_changed", "order", orderId, { shopId: o.shop_id, payload: { orderId, paymentStatus: "confirmed", token } });
    await emit(c, "order.created", "order", orderId, { shopId: o.shop_id, payload: { orderId, released: true } });
    await emit(c, "dashboard.changed", "dashboard", null, { shopId: o.shop_id });
    await audit(c, { type: "staff", staffId: staff.id }, "payment.confirm", "order", orderId, { token });
  });
  return (await fetchOrderDTOById(orderId))!;
}

export async function rejectPayment(orderId: string, reason: string, staff: StaffPrincipal): Promise<Record<string, unknown>> {
  await tx(async (c) => {
    const r = await c.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    const o = r.rows[0];
    if (!o) throw new ApiError(404, "ORDER_NOT_FOUND", "Order nahi mila");
    if (o.payment_status !== "proof_pending") throw new ApiError(409, "NOT_PENDING", "Ye order tasdeeq ke liye pending nahi hai");
    // Placement had deducted the stock — give it back exactly once.
    await restoreStock(c, o, { type: "staff", staff });
    await c.query("UPDATE orders SET payment_status = 'rejected', reject_reason = $2, updated_at = now(), version = version + 1 WHERE id = $1", [orderId, reason]);
    await c.query(
      `UPDATE payments SET status = 'failed', failed_at = now()
       WHERE bill_id IN (SELECT bill_id FROM bill_orders WHERE order_id = $1) AND status = 'pending_confirmation'`,
      [orderId]
    );
    await emit(c, "order.payment_changed", "order", orderId, { shopId: o.shop_id, payload: { orderId, paymentStatus: "rejected" } });
    await emit(c, "stock.changed", "inventory", null, { shopId: o.shop_id });
    await audit(c, { type: "staff", staffId: staff.id }, "payment.reject", "order", orderId, { reason });
  });
  return (await fetchOrderDTOById(orderId))!;
}

export async function reproofPayment(orderId: string, proof: { method: string; txnId?: string; amount: number; proofImage: string }, customer: CustomerPrincipal): Promise<Record<string, unknown>> {
  await tx(async (c) => {
    const r = await c.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    const o = r.rows[0];
    if (!o) throw new ApiError(404, "ORDER_NOT_FOUND", "Order nahi mila");
    if (o.customer_id !== customer.id) throw new ApiError(403, "FORBIDDEN", "Ye aap ka order nahi hai");
    if (o.payment_status !== "rejected") throw new ApiError(409, "NOT_REJECTED", "Sirf rejected order par dobara proof lag sakta hai");
    // Rejection had restored the stock — deduct again for the new attempt.
    await deductStockAgain(c, o, { type: "customer", customer });
    await c.query(
      `UPDATE orders SET payment_status = 'proof_pending', reject_reason = NULL, proof_method = $2, proof_txn_ref = $3,
         proof_amount_paisa = $4, proof_image = $5, proof_uploaded_at = now(), updated_at = now(), version = version + 1
       WHERE id = $1`,
      [orderId, proof.method, proof.txnId ?? null, paisa(proof.amount), proof.proofImage]
    );
    await c.query(
      `INSERT INTO payments (bill_id, payment_kind, method, amount_paisa, status, provider_reference)
       SELECT bill_id, 'tender', $2, $3, 'pending_confirmation', $4 FROM bill_orders WHERE order_id = $1`,
      [orderId, WALLET_METHOD[proof.method] ?? "other", paisa(proof.amount), proof.txnId ?? null]
    );
    await emit(c, "order.payment_changed", "order", orderId, { shopId: o.shop_id, payload: { orderId, paymentStatus: "proof_pending" } });
    await emit(c, "stock.changed", "inventory", null, { shopId: o.shop_id });
    await audit(c, { type: "customer", customerId: customer.id }, "payment.reproof", "order", orderId, {});
  });
  return (await fetchOrderDTOById(orderId))!;
}
