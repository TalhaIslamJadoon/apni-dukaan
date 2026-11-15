// DB row → Phase 1 DTO mappers. The UI keeps consuming the exact shapes from
// lib/store.ts (rupee numbers, legacy string ids); the server stores paisa +
// uuids and converts only at this boundary (plan §3.1, §5.1).
import { q, one, rupees } from "./db";

export const lid = (row: { legacy_id?: string | null; id: string }) => row.legacy_id ?? row.id;

export interface ShopSettingsDTO {
  collegeName: string;
  canteenName: string;
  groceryName: string;
  jazzcashNumber: string;
  easypaisaNumber: string;
  raastInfo: string;
  wholesaleMinPieces: number;
  wholesaleMinKg: number;
  shopOpen: boolean;
  closedContactNumber: string;
  tableCount: number;
  // Business Setup (SALE version): which halves of the system are ON and,
  // for the retail half, which of the 14 shop templates it follows. The
  // public bootstrap exposes exactly this shape so /online and the display
  // boards gate themselves the same way the staff UI does.
  hasCanteen: boolean;
  retailType: string | null;
  setupDone: boolean;
}

export async function shopSettingsDTO(): Promise<ShopSettingsDTO> {
  const s = await one<any>("SELECT * FROM system_settings WHERE id = true");
  const shops = await q<any>("SELECT kind, display_name FROM shops");
  const name = (k: string, dflt: string) => shops.find((x) => x.kind === k)?.display_name ?? dflt;
  return {
    collegeName: s?.college_name ?? "",
    canteenName: name("canteen", "College Canteen"),
    groceryName: name("grocery", "Campus Grocery Store"),
    jazzcashNumber: s?.jazzcash_number || "03XX-XXXXXXX (demo)",
    easypaisaNumber: s?.easypaisa_number || "03XX-XXXXXXX (demo)",
    raastInfo: s?.raast_info || "03XX-XXXXXXX (demo Raast ID)",
    wholesaleMinPieces: Number(s?.wholesale_min_pieces ?? 10),
    wholesaleMinKg: Number(s?.wholesale_min_kg ?? 5),
    shopOpen: s?.shop_open ?? true,
    closedContactNumber: s?.closed_contact_number || "0300-0000000 (demo)",
    tableCount: Math.min(100, Math.max(1, Math.round(Number(s?.table_count ?? 8)) || 8)),
    hasCanteen: s?.has_canteen ?? true,
    retailType: s?.retail_type ?? "grocery",
    setupDone: s?.setup_done ?? true,
  };
}

export async function shopIdByKind(kind: "canteen" | "grocery"): Promise<string> {
  const r = await one<{ id: string }>("SELECT id FROM shops WHERE kind = $1", [kind]);
  if (!r) throw new Error(`shop ${kind} missing — database not seeded`);
  return r.id;
}
export async function shopKindById(id: string): Promise<"canteen" | "grocery"> {
  const r = await one<{ kind: "canteen" | "grocery" }>("SELECT kind FROM shops WHERE id = $1", [id]);
  return r?.kind ?? "canteen";
}

// ── Menu ─────────────────────────────────────────────────────────────────────
// cost (lagat) is OWNER data — it is only included for staff callers
// (includeCost); the public catalogue never carries it.
export async function fetchMenuDTOs(includeCost = false): Promise<unknown[]> {
  const rows = await q<any>(
    `SELECT m.*, c.name AS category_name, COALESCE(b.quantity_on_hand, 0) AS stock
     FROM menu_items m
     JOIN canteen_categories c ON c.id = m.category_id
     LEFT JOIN inventory_balances b ON b.menu_item_id = m.id
     WHERE m.is_active = true
     ORDER BY c.sort_order, m.sort_order, m.name`
  );
  return rows.map((r) => ({
    id: lid(r),
    name: r.name,
    price: rupees(r.price_paisa),
    ...(includeCost && r.cost_paisa !== null && r.cost_paisa !== undefined ? { cost: rupees(r.cost_paisa) } : {}),
    category: r.category_name,
    emoji: r.emoji,
    ...(r.image_url ? { image: r.image_url } : {}),
    ...(r.sku ? { sku: r.sku } : {}),
    stock: Number(r.stock),
    lowStock: Number(r.low_stock_qty),
  }));
}

// ── Deals ────────────────────────────────────────────────────────────────────
// Phase 1 Deal shape: { id, name, items: [{ menuItemId, qty }], price,
// active }. menuItemId is the menu item's legacy id, like everywhere else.
export async function fetchDealDTOs(activeOnly = false): Promise<unknown[]> {
  const rows = await q<any>(
    `SELECT d.*, di.qty, di.sort_order AS item_sort, mi.legacy_id AS item_legacy
     FROM deals d
     LEFT JOIN deal_items di ON di.deal_id = d.id
     LEFT JOIN menu_items mi ON mi.id = di.menu_item_id
     ${activeOnly ? "WHERE d.is_active = true" : ""}
     ORDER BY d.sort_order, d.created_at, di.sort_order`
  );
  const byId = new Map<string, any>();
  for (const r of rows) {
    const id = lid(r);
    if (!byId.has(id)) {
      byId.set(id, {
        id, name: r.name, price: rupees(r.price_paisa), active: !!r.is_active,
        items: [] as { menuItemId: string; qty: number }[],
      });
    }
    if (r.item_legacy) byId.get(id).items.push({ menuItemId: r.item_legacy, qty: Number(r.qty) });
  }
  return [...byId.values()];
}

// ── Grocery ──────────────────────────────────────────────────────────────────
export interface GroceryDTOs {
  heads: unknown[];
  subs: unknown[];
  items: unknown[];
}

export async function fetchGroceryDTOs(includeWholesale: boolean): Promise<GroceryDTOs> {
  const heads = await q<any>("SELECT * FROM grocery_heads WHERE is_active = true ORDER BY sort_order, name");
  const subs = await q<any>(
    `SELECT s.*, h.legacy_id AS head_legacy, h.id AS head_uuid FROM grocery_sub_heads s
     JOIN grocery_heads h ON h.id = s.head_id WHERE s.is_active = true ORDER BY s.sort_order, s.name`
  );
  const products = await q<any>(
    `SELECT p.*, s.legacy_id AS sub_legacy, s.id AS sub_uuid, h.legacy_id AS head_legacy,
            COALESCE(b.quantity_on_hand, 0) AS stock
     FROM grocery_products p
     JOIN grocery_sub_heads s ON s.id = p.sub_head_id
     JOIN grocery_heads h ON h.id = s.head_id
     LEFT JOIN inventory_balances b ON b.grocery_product_id = p.id
     WHERE p.is_active = true ORDER BY p.name`
  );
  const variants = await q<any>(
    `SELECT v.*, p.legacy_id AS product_legacy FROM grocery_variants v
     JOIN grocery_products p ON p.id = v.product_id WHERE v.is_active = true ORDER BY v.sort_order, v.name`
  );
  const packings = await q<any>(
    `SELECT pk.*, v.id AS variant_uuid FROM grocery_packings pk
     JOIN grocery_variants v ON v.id = pk.variant_id WHERE pk.is_active = true ORDER BY pk.sort_order, pk.label`
  );
  const headLegacyByUuid = new Map(heads.map((h) => [h.id, lid(h)]));
  const packDTO = (pk: any) => ({
    label: pk.label,
    ...(Number(pk.contains_qty ?? 1) !== 1 ? { containsQty: Number(pk.contains_qty) } : {}),
    retailPrice: rupees(pk.retail_price_paisa),
    wholesalePrice: includeWholesale ? rupees(pk.wholesale_price_paisa) : rupees(pk.retail_price_paisa),
    ...(pk.barcode ? { barcode: pk.barcode } : {}),
    ...(pk.wholesale_min_qty !== null && pk.wholesale_min_qty !== undefined ? { wholesaleMinQty: Number(pk.wholesale_min_qty) } : {}),
    ...(pk.stock_qty !== null && pk.stock_qty !== undefined ? { stock: Number(pk.stock_qty) } : {}),
  });
  const variantsByProduct = new Map<string, any[]>();
  for (const v of variants) {
    const arr = variantsByProduct.get(v.product_id) ?? [];
    arr.push({
      id: lid(v),
      name: v.name,
      packings: packings.filter((pk) => pk.variant_uuid === v.id).map(packDTO),
    });
    variantsByProduct.set(v.product_id, arr);
  }
  return {
    heads: heads.map((h) => ({
      id: lid(h), name: h.name, emoji: h.emoji, tint: h.tint,
      ...(h.image_url ? { image: h.image_url } : {}),
    })),
    subs: subs.map((s) => ({
      id: lid(s), headId: headLegacyByUuid.get(s.head_id) ?? s.head_legacy ?? s.head_uuid, name: s.name,
      ...(s.image_url ? { image: s.image_url } : {}),
    })),
    items: products.map((p) => {
      const vars = variantsByProduct.get(p.id) ?? [];
      const standard = vars.find((v) => v.name === "Standard") ?? vars[0];
      return {
        id: lid(p),
        name: p.name,
        ...(p.brand ? { brand: p.brand } : {}),
        headId: p.head_legacy ?? "",
        subId: p.sub_legacy ?? "",
        sku: p.sku,
        ...(p.barcode ? { barcode: p.barcode } : {}),
        retailPrice: rupees(p.retail_price_paisa),
        wholesalePrice: includeWholesale ? rupees(p.wholesale_price_paisa) : rupees(p.retail_price_paisa),
        ...(p.wholesale_min_qty !== null && p.wholesale_min_qty !== undefined ? { wholesaleMinQty: Number(p.wholesale_min_qty) } : {}),
        stock: Number(p.stock),
        unit: p.unit,
        lowStock: Number(p.low_stock_qty),
        ...(p.board_offer ? { boardOffer: true } : {}),
        ...(p.offer_price_paisa !== null && p.offer_price_paisa !== undefined ? { offerPrice: rupees(p.offer_price_paisa) } : {}),
        ...(p.track_serial ? { trackSerial: true } : {}),
        emoji: p.emoji,
        ...(p.image_url ? { image: p.image_url } : {}),
        ...(standard && standard.packings.length ? { packings: standard.packings } : {}),
        ...(vars.length ? { variants: vars } : {}),
      };
    }),
  };
}

// ── Orders ───────────────────────────────────────────────────────────────────
const STATUS_TO_UI: Record<string, string> = {
  received: "pending", preparing: "preparing", ready: "ready", completed: "ready", cancelled: "ready",
};

export function lineDisplayName(l: any): string {
  const parts: string[] = [];
  if (l.variant_name_snapshot && l.variant_name_snapshot !== "Standard") parts.push(l.variant_name_snapshot);
  if (l.packing_label_snapshot) parts.push(l.packing_label_snapshot);
  else if (l.item_kind === "grocery_product" && l.unit_snapshot === "kg") parts.push("kg");
  const base = parts.length ? `${l.item_name_snapshot} (${parts.join(" · ")})` : l.item_name_snapshot;
  // Offer-priced lines carry the Phase 1 "(Offer)" tag — receipts, kitchen
  // tickets and the print agent all render this same display name.
  return l.is_offer ? `${base} (Offer)` : base;
}

export function orderDTO(o: any, lines: any[], billNo: string | null): Record<string, unknown> {
  const mode = o.shop_kind as "canteen" | "grocery";
  const dto: Record<string, unknown> = {
    id: o.id,
    ...(billNo ? { billNo } : {}),
    mode,
    ...(mode === "grocery" ? { priceType: o.price_type } : {}),
    token: o.token_no ?? 0,
    lines: lines.map((l) => ({
      itemId: l.item_kind === "deal" ? `deal:${l.deal_legacy ?? l.deal_id}` : (l.item_legacy ?? l.menu_item_id ?? l.grocery_product_id),
      name: lineDisplayName(l),
      price: rupees(l.unit_price_paisa),
      qty: Number(l.quantity),
      // Deal lines carry their order-time component snapshot (kitchen +
      // receipts render it); serial-tracked lines carry their IMEIs.
      ...(l.components ? { components: l.components } : {}),
      ...(l.serials ? { serials: l.serials } : {}),
    })),
    subtotal: rupees(o.subtotal_paisa),
    discount: rupees(o.discount_paisa),
    total: rupees(o.total_paisa),
    ...(o.cashier_name ? { cashier: o.cashier_name } : {}),
    payment: o.payment_method ?? "Cash",
    ...(o.payment_status ? { paymentStatus: o.payment_status } : {}),
    ...(o.payment_status && o.proof_method ? {
      paymentProof: {
        method: o.proof_method,
        ...(o.proof_txn_ref ? { txnId: o.proof_txn_ref } : {}),
        amount: rupees(o.proof_amount_paisa ?? o.total_paisa),
        proofImage: o.proof_image ?? "",
        uploadedAt: o.proof_uploaded_at ? new Date(o.proof_uploaded_at).getTime() : Date.now(),
      },
    } : {}),
    ...(o.reject_reason ? { rejectReason: o.reject_reason } : {}),
    ...(o.tendered_paisa !== null && o.tendered_paisa !== undefined ? { tendered: rupees(o.tendered_paisa) } : {}),
    ...(o.change_paisa !== null && o.change_paisa !== undefined ? { change: rupees(o.change_paisa) } : {}),
    ...(o.payment_method === "Udhaar" && o.customer_name_snapshot ? { udhaarName: o.customer_name_snapshot } : {}),
    source: o.source === "counter" ? "counter" : "online",
    ...(o.source !== "counter" ? {
      orderType: o.fulfilment_type === "dine_in" ? "dine-in" : "takeaway",
      ...(o.table_no ? { tableNo: o.table_no } : {}),
      ...(o.customer_name_snapshot ? { customerName: o.customer_name_snapshot } : {}),
      ...(o.customer_external_id_snapshot ? { customerId: o.customer_external_id_snapshot } : {}),
      ...(o.customer_mobile_snapshot ? { customerMobile: o.customer_mobile_snapshot } : {}),
      identityType: o.source === "remote_online" ? "account" : "table",
      ...(o.place_label_snapshot ? { placeLabel: o.place_label_snapshot } : {}),
    } : {}),
    status: STATUS_TO_UI[o.status] ?? "pending",
    dbStatus: o.status,
    createdAt: new Date(o.created_at).toISOString(),
  };
  return dto;
}

const ORDER_SELECT = `
  SELECT o.*, s.kind AS shop_kind, t.table_no, cs.display_name AS cashier_name,
         (SELECT b.bill_no FROM bill_orders bo JOIN bills b ON b.id = bo.bill_id WHERE bo.order_id = o.id LIMIT 1) AS bill_no
  FROM orders o
  JOIN shops s ON s.id = o.shop_id
  LEFT JOIN dining_tables t ON t.id = o.table_id
  LEFT JOIN staff_users cs ON cs.id = o.cashier_staff_id`;

export async function fetchOrderDTOById(id: string): Promise<Record<string, unknown> | null> {
  const o = await one<any>(`${ORDER_SELECT} WHERE o.id = $1`, [id]);
  if (!o) return null;
  const lines = await q<any>(
    `SELECT l.*, mi.legacy_id AS item_legacy, d.legacy_id AS deal_legacy FROM order_lines l
     LEFT JOIN menu_items mi ON mi.id = l.menu_item_id
     LEFT JOIN deals d ON d.id = l.deal_id
     WHERE l.order_id = $1 ORDER BY l.line_no`,
    [id]
  );
  // grocery line itemId must be the product legacy id
  const glines = await q<any>(
    `SELECT l.id, gp.legacy_id FROM order_lines l JOIN grocery_products gp ON gp.id = l.grocery_product_id WHERE l.order_id = $1`,
    [id]
  );
  const gmap = new Map(glines.map((g) => [g.id, g.legacy_id]));
  for (const l of lines) if (gmap.has(l.id)) l.item_legacy = gmap.get(l.id);
  return orderDTO(o, lines, o.bill_no);
}

export async function fetchOrdersDTO(filters: {
  businessDate?: string;
  shopKind?: "canteen" | "grocery";
  source?: string;
  customerId?: string;
  statuses?: string[];
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace("?", `$${params.length}`)); };
  if (filters.businessDate) add("o.business_date = ?", filters.businessDate);
  if (filters.shopKind) add("s.kind = ?", filters.shopKind);
  if (filters.source) add("o.source = ?", filters.source);
  if (filters.customerId) add("o.customer_id = ?", filters.customerId);
  if (filters.statuses?.length) {
    params.push(filters.statuses);
    where.push(`o.status = ANY($${params.length})`);
  }
  const rows = await q<any>(
    `${ORDER_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY o.created_at DESC LIMIT ${Math.min(filters.limit ?? 300, 1000)}`,
    params
  );
  const out: Record<string, unknown>[] = [];
  for (const o of rows) out.push((await fetchOrderDTOById(o.id))!);
  return out;
}

// ── Staff ────────────────────────────────────────────────────────────────────
export function staffDTO(u: any, tabs: string[]): Record<string, unknown> {
  return {
    id: u.legacy_id ?? u.id,
    uuid: u.id,
    name: u.display_name,
    pin: "", // credentials are never returned; owner sets a new PIN to change it
    tabs,
    ...(u.is_owner ? { isOwner: true } : {}),
    isActive: u.is_active,
    mustChangeCredential: !!u.must_change_credential,
  };
}

export async function fetchStaffDTOs(): Promise<Record<string, unknown>[]> {
  const users = await q<any>("SELECT * FROM staff_users ORDER BY is_owner DESC, created_at ASC");
  const out: Record<string, unknown>[] = [];
  for (const u of users) {
    const grants = await q<{ tab_key: string }>("SELECT tab_key FROM staff_tab_grants WHERE staff_user_id = $1", [u.id]);
    out.push(staffDTO(u, grants.map((g) => g.tab_key)));
  }
  return out;
}
