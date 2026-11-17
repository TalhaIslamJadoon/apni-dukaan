// ─────────────────────────────────────────────────────────────────────────────
// Profit & Loss (Munafa / Nuqsan) — server compute, Phase 1 rules exactly
// (lib/store.computeProfitLoss ka server version):
//
//   SALE SET: sirf woh orders jin ki payment clear hai — payment_status
//   NULL (counter / table-QR cash / udhaar bills) ya 'confirmed'.
//   proof_pending / rejected orders bikri mein NAHI ginte. Cancelled
//   orders bhi nahi (un ka stock wapas ho chuka hota hai).
//   Bill DISCOUNT har line par proportionally bantta hai (factor =
//   order.total / Σ line price×qty) taake per-item bikri ka kul jama
//   hamesha Kul Bikri ke barabar rahe.
//   LAGAT (cost):
//     • grocery line → sold packing ki wholesale price (packing na ho to
//       product ki wholesale) — offer par biki line ki lagat bhi wholesale
//       hi rehti hai; wholesale-bill line par lagat ≈ bikri (margin ~0,
//       jo sach hai).
//     • canteen line → menu item ki current `cost` (owner-bhari lagat).
//     • deal line → order-time component snapshot × current menu costs ka
//       jama; EK bhi component ki lagat missing ho to POORI line
//       lagat-baqi.
//   MISSING COST KABHI 0 NAHI: jis line ki lagat maloom nahi, us ki bikri
//   "Lagat Baqi Bikri" mein alag jati hai aur munafa mein NAHI ginti —
//   item warning list ke sath.
//   KHARCHAY (expenses): canteen/grocery apne column mein; "both" wala
//   kharcha SIRF combined column mein ginta hai.
//   WASTAGE: stock entries ki wastage × wholesale cost — sirf grocery
//   (canteen wastage is report mein nahi ginta).
//   UDHAAR info line: period mein diya gaya udhaar (bikri mein pehle se
//   shamil), period ki wasooli (sirf cash maloomat), all-time baqaya.
// ─────────────────────────────────────────────────────────────────────────────
import { q, one, tx, ApiError, rupees, paisa } from "../db";
import { audit } from "../events";
import type { StaffPrincipal } from "../auth";

export interface ShopPnL { bikri: number; lagat: number; lagatBaqi: number; gross: number; kharchay: number; wastage: number; net: number }
export interface PnLItemRow { key: string; name: string; shop: "canteen" | "grocery"; qty: number; bikri: number; lagat: number; lagatKnown: boolean }
export interface PnLItemOut { key: string; name: string; shop: "canteen" | "grocery"; qty: number; bikri: number; lagat: number | null; munafa: number | null }
export interface PnLReport {
  canteen: ShopPnL; grocery: ShopPnL; combined: ShopPnL;
  items: PnLItemOut[];
  unknownItems: { key: string; name: string; shop: "canteen" | "grocery"; bikri: number }[];
  udhaarDiya: number; wasooliPeriod: number; baqayaAllTime: number;
}

const blank = (): ShopPnL => ({ bikri: 0, lagat: 0, lagatBaqi: 0, gross: 0, kharchay: 0, wastage: 0, net: 0 });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function computePnL(from: string, to: string): Promise<PnLReport> {
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
    throw new ApiError(400, "BAD_RANGE", "Period ki tareekhein ghalat hain");
  }
  const orders = await q<any>(
    `SELECT o.id, o.total_paisa, o.subtotal_paisa, o.payment_method, s.kind AS shop_kind
     FROM orders o JOIN shops s ON s.id = o.shop_id
     WHERE o.business_date >= $1::date AND o.business_date <= $2::date
       AND o.status <> 'cancelled'
       AND (o.payment_status IS NULL OR o.payment_status = 'confirmed')`,
    [from, to]
  );
  const orderIds = orders.map((o) => o.id);
  const lines = orderIds.length ? await q<any>(
    `SELECT l.*, o.shop_kind AS line_shop,
            mi.legacy_id AS menu_legacy, mi.name AS menu_name, mi.cost_paisa AS menu_cost,
            gp.legacy_id AS prod_legacy, gp.wholesale_price_paisa AS prod_ws,
            pk.wholesale_price_paisa AS pack_ws,
            d.legacy_id AS deal_legacy
     FROM order_lines l
     JOIN (SELECT o2.id, s2.kind AS shop_kind FROM orders o2 JOIN shops s2 ON s2.id = o2.shop_id) o ON o.id = l.order_id
     LEFT JOIN menu_items mi ON mi.id = l.menu_item_id
     LEFT JOIN grocery_products gp ON gp.id = l.grocery_product_id
     LEFT JOIN grocery_packings pk ON pk.id = l.grocery_packing_id
     LEFT JOIN deals d ON d.id = l.deal_id
     WHERE l.order_id = ANY($1)`,
    [orderIds]
  ) : [];
  const linesByOrder = new Map<string, any[]>();
  for (const l of lines) {
    const arr = linesByOrder.get(l.order_id) ?? [];
    arr.push(l);
    linesByOrder.set(l.order_id, arr);
  }
  // Menu costs by legacy id (deal components resolve through the snapshot).
  const menuRows = await q<any>("SELECT legacy_id, id, name, cost_paisa FROM menu_items");
  const menuByLegacy = new Map(menuRows.map((m) => [m.legacy_id ?? m.id, m]));

  const canteen = blank(), grocery = blank();
  const totalsOf = (shop: "canteen" | "grocery") => (shop === "canteen" ? canteen : grocery);
  const itemMap = new Map<string, PnLItemRow>();
  const unknownMap = new Map<string, { key: string; name: string; shop: "canteen" | "grocery"; bikri: number }>();
  let udhaarDiyaP = 0;

  for (const o of orders) {
    const shop = o.shop_kind as "canteen" | "grocery";
    const t = totalsOf(shop);
    const olines = linesByOrder.get(o.id) ?? [];
    const lineSum = olines.reduce((s, l) => s + Number(l.line_total_paisa), 0);
    const factor = lineSum > 0 ? Number(o.total_paisa) / lineSum : 1;
    if (o.payment_method === "Udhaar") udhaarDiyaP += Number(o.total_paisa);
    for (const l of olines) {
      const bikriP = Number(l.line_total_paisa) * factor;
      t.bikri += bikriP;
      const qty = Number(l.quantity);
      let lagatP: number | null = null;
      let key: string;
      let name: string;
      if (l.item_kind === "deal") {
        key = `deal:${l.deal_legacy ?? l.item_name_snapshot}`;
        name = l.item_name_snapshot;
        const comps = (l.components ?? []) as { itemId: string; qty: number }[];
        lagatP = 0;
        for (const comp of comps) {
          const mi = menuByLegacy.get(comp.itemId);
          if (!mi || mi.cost_paisa === null || mi.cost_paisa === undefined) { lagatP = null; break; }
          lagatP += Number(mi.cost_paisa) * comp.qty * qty;
        }
      } else if (l.item_kind === "grocery_product") {
        key = l.prod_legacy ?? l.grocery_product_id;
        name = String(l.item_name_snapshot)
          + (l.variant_name_snapshot && l.variant_name_snapshot !== "Standard" ? ` (${l.variant_name_snapshot}${l.packing_label_snapshot ? ` · ${l.packing_label_snapshot}` : ""})` : l.packing_label_snapshot ? ` (${l.packing_label_snapshot})` : "");
        const ws = l.pack_ws !== null && l.pack_ws !== undefined ? Number(l.pack_ws) : (l.prod_ws !== null && l.prod_ws !== undefined ? Number(l.prod_ws) : null);
        lagatP = ws === null ? null : ws * qty;
      } else {
        key = l.menu_legacy ?? l.menu_item_id;
        name = l.menu_name ?? l.item_name_snapshot;
        lagatP = l.menu_cost === null || l.menu_cost === undefined ? null : Number(l.menu_cost) * qty;
      }
      // Per-item table mein HAR item ata hai — lagat na ho to us item ki
      // lagat/munafa null (Phase 1 rule: missing cost kabhi 0 nahi).
      const row = itemMap.get(key) ?? { key, name, shop, qty: 0, bikri: 0, lagat: 0, lagatKnown: true };
      row.qty += qty; row.bikri += bikriP;
      if (lagatP === null) {
        t.lagatBaqi += bikriP;
        row.lagatKnown = false;
        const u = unknownMap.get(key) ?? { key, name, shop, bikri: 0 };
        u.bikri += bikriP;
        unknownMap.set(key, u);
      } else {
        t.lagat += lagatP;
        row.lagat += lagatP;
      }
      itemMap.set(key, row);
    }
  }

  // Wastage (grocery only) — stock-entry wastage × product wholesale.
  const wast = await one<{ amt: number }>(
    `SELECT COALESCE(SUM(ABS(e.qty_delta) * p.wholesale_price_paisa), 0) AS amt
     FROM stock_entries e
     JOIN inventory_balances b ON b.id = e.inventory_id
     JOIN grocery_products p ON p.id = b.grocery_product_id
     WHERE e.entry_type = 'wastage'
       AND (e.created_at AT TIME ZONE 'Asia/Karachi')::date >= $1::date
       AND (e.created_at AT TIME ZONE 'Asia/Karachi')::date <= $2::date`,
    [from, to]
  );
  grocery.wastage = Number(wast?.amt ?? 0);

  // Rental aamdani (Kiraya) — grocery column mein, lagat ke baghair
  // (Phase 1 parity). CASH-BASIS: advance apni advance_date par, baqaya
  // balance_date par, late fine + damage settled_date par (wapsi par woh
  // wasool hote hain ya security se kat te hain). Cancelled booking ka
  // koi event nahi. Security DEPOSIT kabhi aamdani nahi — woh amanat
  // hai. Dress ki khareed lagat yahan NAHI ati: woh owner Kharchay mein
  // alag se likhta hai, is liye rows lagatKnown=true, lagat=0.
  const rentRows = await q<any>(
    `SELECT b.item_id, i.legacy_id AS item_legacy, b.item_name,
            b.advance_paid_paisa, b.advance_date,
            b.balance_paid_paisa, b.balance_date,
            b.late_fine_paisa, b.damage_charges_paisa, b.settled_date, b.status
     FROM rental_bookings b JOIN rental_items i ON i.id = b.item_id
     WHERE b.status <> 'cancelled'`
  );
  const inRange = (d: unknown): boolean => {
    if (d === null || d === undefined) return false;
    const s = typeof d === "string" ? d.slice(0, 10) : new Date(d as string).toISOString().slice(0, 10);
    return s >= from && s <= to;
  };
  for (const r of rentRows) {
    let amt = 0;
    if (Number(r.advance_paid_paisa) > 0 && inRange(r.advance_date)) amt += Number(r.advance_paid_paisa);
    if (Number(r.balance_paid_paisa) > 0 && inRange(r.balance_date)) amt += Number(r.balance_paid_paisa);
    if (r.status === "completed" && inRange(r.settled_date)) amt += Number(r.late_fine_paisa) + Number(r.damage_charges_paisa);
    if (amt <= 0) continue;
    grocery.bikri += amt;
    const key = `rental:${r.item_legacy ?? r.item_id}`;
    const row = itemMap.get(key) ?? { key, name: `👰 Kiraya — ${r.item_name}`, shop: "grocery" as const, qty: 0, bikri: 0, lagat: 0, lagatKnown: true };
    row.qty += 1; row.bikri += amt;
    itemMap.set(key, row);
  }

  // Expenses — shop columns; "both" counts ONLY in the combined column.
  const expRows = await q<any>(
    "SELECT shop, COALESCE(SUM(amount_paisa),0) AS amt FROM expenses WHERE expense_date >= $1::date AND expense_date <= $2::date GROUP BY shop",
    [from, to]
  );
  let bothExpP = 0;
  for (const r of expRows) {
    if (r.shop === "canteen") canteen.kharchay = Number(r.amt);
    else if (r.shop === "grocery") grocery.kharchay = Number(r.amt);
    else if (r.shop === "both") bothExpP = Number(r.amt);
  }

  for (const t of [canteen, grocery]) {
    t.gross = t.bikri - t.lagatBaqi - t.lagat;
    t.net = t.gross - t.kharchay - t.wastage;
  }
  const combined: ShopPnL = {
    bikri: canteen.bikri + grocery.bikri,
    lagat: canteen.lagat + grocery.lagat,
    lagatBaqi: canteen.lagatBaqi + grocery.lagatBaqi,
    gross: 0, kharchay: canteen.kharchay + grocery.kharchay + bothExpP,
    wastage: grocery.wastage, net: 0,
  };
  combined.gross = combined.bikri - combined.lagatBaqi - combined.lagat;
  combined.net = combined.gross - combined.kharchay - combined.wastage;

  // Udhaar info: period wasooli (ledger payments) + all-time baqaya.
  const was = await one<{ amt: number }>(
    `SELECT COALESCE(SUM(-amount_paisa),0) AS amt FROM udhaar_ledger_entries
     WHERE entry_type = 'payment'
       AND (created_at AT TIME ZONE 'Asia/Karachi')::date >= $1::date
       AND (created_at AT TIME ZONE 'Asia/Karachi')::date <= $2::date`,
    [from, to]
  );
  const baq = await one<{ amt: number }>("SELECT COALESCE(SUM(amount_paisa),0) AS amt FROM udhaar_ledger_entries");

  const toRs = (t: ShopPnL): ShopPnL => ({
    bikri: rupees(t.bikri), lagat: rupees(t.lagat), lagatBaqi: rupees(t.lagatBaqi),
    gross: rupees(t.gross), kharchay: rupees(t.kharchay), wastage: rupees(t.wastage), net: rupees(t.net),
  });
  return {
    canteen: toRs(canteen), grocery: toRs(grocery), combined: toRs(combined),
    items: [...itemMap.values()]
      .map((r) => ({
        key: r.key, name: r.name, shop: r.shop, qty: r.qty,
        bikri: rupees(r.bikri),
        lagat: r.lagatKnown ? rupees(r.lagat) : null,
        munafa: r.lagatKnown ? rupees(r.bikri - r.lagat) : null,
      }))
      .sort((a, b) => (b.munafa ?? -Infinity) - (a.munafa ?? -Infinity)),
    unknownItems: [...unknownMap.values()].map((u) => ({ ...u, bikri: rupees(u.bikri) })),
    udhaarDiya: rupees(udhaarDiyaP),
    wasooliPeriod: rupees(Number(was?.amt ?? 0)),
    baqayaAllTime: rupees(Number(baq?.amt ?? 0)),
  };
}

// ── Expenses register (owner) ────────────────────────────────────────────────
export interface ExpenseDTO {
  id: string; dateISO: string; title: string; amount: number;
  shop: "canteen" | "grocery" | "both"; note?: string;
}

const expDTO = (r: any): ExpenseDTO => ({
  id: r.legacy_id ?? r.id,
  dateISO: typeof r.expense_date === "string" ? r.expense_date.slice(0, 10) : new Date(r.expense_date).toISOString().slice(0, 10),
  title: r.title,
  amount: rupees(r.amount_paisa),
  shop: r.shop,
  ...(r.note ? { note: r.note } : {}),
});

export async function listExpenses(): Promise<ExpenseDTO[]> {
  const rows = await q<any>("SELECT * FROM expenses ORDER BY expense_date DESC, created_at DESC LIMIT 1000");
  return rows.map(expDTO);
}

export interface ExpenseInput { dateISO: string; title: string; amount: number; shop: "canteen" | "grocery" | "both"; note?: string }

function validateExpense(input: ExpenseInput) {
  if (!DATE_RE.test(input.dateISO ?? "")) throw new ApiError(400, "BAD_DATE", "Tareekh chunein");
  if (!input.title?.trim()) throw new ApiError(400, "TITLE_REQUIRED", "Kharcha kis cheez ka hai, woh likhein");
  if (!(input.amount > 0)) throw new ApiError(400, "BAD_AMOUNT", "Raqam sahi likhein (0 se zyada)");
  if (!["canteen", "grocery", "both"].includes(input.shop)) throw new ApiError(400, "BAD_SHOP", "Dukaan ghalat hai");
}

export async function createExpense(input: ExpenseInput, staff: StaffPrincipal): Promise<ExpenseDTO> {
  validateExpense(input);
  const legacy = `exp-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  return tx(async (c) => {
    const ins = await c.query(
      `INSERT INTO expenses (legacy_id, title, amount_paisa, shop, expense_date, note, created_by_staff_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [legacy, input.title.trim(), paisa(input.amount), input.shop, input.dateISO, input.note?.trim() || null, staff.id]
    );
    await audit(c, { type: "staff", staffId: staff.id }, "expense.create", "expense", ins.rows[0].id, { title: input.title, amount: input.amount });
    return expDTO(ins.rows[0]);
  });
}

export async function updateExpense(id: string, input: ExpenseInput, staff: StaffPrincipal): Promise<ExpenseDTO> {
  validateExpense(input);
  return tx(async (c) => {
    const ex = (await c.query("SELECT * FROM expenses WHERE legacy_id = $1 OR id::text = $1 FOR UPDATE", [id])).rows[0];
    if (!ex) throw new ApiError(404, "EXPENSE_NOT_FOUND", "Kharcha nahi mila");
    const upd = await c.query(
      `UPDATE expenses SET title = $2, amount_paisa = $3, shop = $4, expense_date = $5, note = $6,
         updated_at = now(), version = version + 1 WHERE id = $1 RETURNING *`,
      [ex.id, input.title.trim(), paisa(input.amount), input.shop, input.dateISO, input.note?.trim() || null]
    );
    await audit(c, { type: "staff", staffId: staff.id }, "expense.update", "expense", ex.id, { title: input.title, amount: input.amount });
    return expDTO(upd.rows[0]);
  });
}

export async function deleteExpense(id: string, staff: StaffPrincipal): Promise<void> {
  await tx(async (c) => {
    const ex = (await c.query("SELECT * FROM expenses WHERE legacy_id = $1 OR id::text = $1 FOR UPDATE", [id])).rows[0];
    if (!ex) throw new ApiError(404, "EXPENSE_NOT_FOUND", "Kharcha nahi mila");
    await c.query("DELETE FROM expenses WHERE id = $1", [ex.id]);
    await audit(c, { type: "staff", staffId: staff.id }, "expense.delete", "expense", ex.id, { title: ex.title });
  });
}
