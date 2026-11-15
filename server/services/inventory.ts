// Inventory service: stock-in / wastage / adjustments against the append-only
// stock_entries ledger (plan §3.5, §4.3D). Balances change only here, in the
// order transaction, or in payment reject/cancel reversals.
import type { PoolClient } from "pg";
import { tx, q, ApiError, paisa } from "../db";
import { emit, audit } from "../events";
import type { StaffPrincipal } from "../auth";

export async function resolveInventory(c: PoolClient, kind: "canteen" | "grocery", itemId: string) {
  const sql = kind === "canteen"
    ? `SELECT b.*, m.name, m.legacy_id FROM inventory_balances b JOIN menu_items m ON m.id = b.menu_item_id
       WHERE (m.legacy_id = $1 OR m.id::text = $1)`
    : `SELECT b.*, p.name, p.legacy_id FROM inventory_balances b JOIN grocery_products p ON p.id = b.grocery_product_id
       WHERE (p.legacy_id = $1 OR p.id::text = $1)`;
  const r = await c.query(sql, [itemId]);
  if (!r.rows[0]) throw new ApiError(404, "ITEM_NOT_FOUND", "Item nahi mila");
  return r.rows[0];
}

/** Set an item's balance to an absolute value via an adjustment entry. */
export async function setStockAbsolute(c: PoolClient, kind: "canteen" | "grocery", itemId: string, setTo: number, staff: StaffPrincipal, note?: string): Promise<void> {
  const inv = await resolveInventory(c, kind, itemId);
  const locked = await c.query("SELECT * FROM inventory_balances WHERE id = $1 FOR UPDATE", [inv.id]);
  const cur = Number(locked.rows[0].quantity_on_hand);
  const delta = Math.round((setTo - cur) * 1000) / 1000;
  if (delta === 0) return;
  await c.query("UPDATE inventory_balances SET quantity_on_hand = $2, version = version + 1, updated_at = now() WHERE id = $1", [inv.id, setTo]);
  await c.query(
    `INSERT INTO stock_entries (inventory_id, entry_type, qty_delta, qty_after, note, created_by_staff_id)
     VALUES ($1,'adjustment',$2,$3,$4,$5)`,
    [inv.id, delta, setTo, note ?? "Owner stock edit", staff.id]
  );
}

export interface StockEntryInput {
  kind: "canteen" | "grocery";
  itemId: string;
  type: "add" | "wastage";
  qty: number;
  rate?: number; // Rs purchase rate (add)
  supplier?: string;
  reason?: string; // wastage reason
  expiry?: string; // "YYYY-MM" — medical shops: stock-IN par optional expiry mahina
}

export async function createStockEntry(input: StockEntryInput, staff: StaffPrincipal): Promise<Record<string, unknown>> {
  if (!(input.qty > 0)) throw new ApiError(400, "BAD_QUANTITY", "Quantity ghalat hai");
  return tx(async (c) => {
    const inv = await resolveInventory(c, input.kind, input.itemId);
    const locked = await c.query("SELECT * FROM inventory_balances WHERE id = $1 FOR UPDATE", [inv.id]);
    const cur = Number(locked.rows[0].quantity_on_hand);
    const delta = input.type === "add" ? input.qty : -input.qty;
    const after = Math.round((cur + delta) * 1000) / 1000;
    if (after < 0) throw new ApiError(409, "INSUFFICIENT_STOCK", "Wastage maujooda stock se zyada hai", { availableQty: cur });
    await c.query("UPDATE inventory_balances SET quantity_on_hand = $2, version = version + 1, updated_at = now() WHERE id = $1", [inv.id, after]);
    let supplierId: string | null = null;
    if (input.supplier?.trim()) {
      const s = await c.query("INSERT INTO suppliers (name) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id", [input.supplier.trim()]);
      if (s.rows[0]) supplierId = s.rows[0].id;
      else {
        const ex = await c.query("SELECT id FROM suppliers WHERE lower(name) = lower($1) LIMIT 1", [input.supplier.trim()]);
        supplierId = ex.rows[0]?.id ?? null;
      }
    }
    const expiry = input.type === "add" && input.expiry && /^\d{4}-\d{2}$/.test(input.expiry) ? input.expiry : null;
    const ins = await c.query(
      `INSERT INTO stock_entries (inventory_id, entry_type, qty_delta, qty_after, purchase_rate_paisa, supplier_id, supplier_name_snapshot, reason, expiry, created_by_staff_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, created_at`,
      [inv.id, input.type === "add" ? "stock_in" : "wastage", delta, after,
       input.rate !== undefined ? paisa(input.rate) : null, supplierId, input.supplier ?? null, input.reason ?? null, expiry, staff.id]
    );
    await emit(c, "stock.changed", "inventory", inv.id, { shopId: inv.shop_id });
    await audit(c, { type: "staff", staffId: staff.id }, `stock.${input.type}`, "inventory", inv.id, { qty: input.qty, after });
    return {
      id: ins.rows[0].id,
      at: new Date(ins.rows[0].created_at).toISOString(),
      kind: input.kind,
      itemId: inv.legacy_id ?? input.itemId,
      itemName: inv.name,
      type: input.type,
      qty: input.qty,
      unit: input.kind === "grocery" ? "piece" : "pcs",
      ...(input.rate !== undefined ? { rate: input.rate } : {}),
      ...(input.supplier ? { supplier: input.supplier } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(expiry ? { expiry } : {}),
      by: staff.name,
    };
  });
}

export async function listStockEntries(kind?: string, limit = 200): Promise<Record<string, unknown>[]> {
  const rows = await q<any>(
    `SELECT e.*, COALESCE(m.name, p.name) AS item_name, COALESCE(m.legacy_id, p.legacy_id) AS item_legacy,
            s.display_name AS by_name, sh.kind AS shop_kind, p.unit AS p_unit
     FROM stock_entries e
     JOIN inventory_balances b ON b.id = e.inventory_id
     JOIN shops sh ON sh.id = b.shop_id
     LEFT JOIN menu_items m ON m.id = b.menu_item_id
     LEFT JOIN grocery_products p ON p.id = b.grocery_product_id
     LEFT JOIN staff_users s ON s.id = e.created_by_staff_id
     WHERE e.entry_type IN ('stock_in','wastage','adjustment')
     ORDER BY e.created_at DESC LIMIT $1`,
    [limit]
  );
  return rows
    .filter((r) => !kind || r.shop_kind === kind)
    .map((r) => ({
      id: r.id,
      at: new Date(r.created_at).toISOString(),
      kind: r.shop_kind,
      itemId: r.item_legacy ?? "",
      itemName: r.item_name,
      type: r.entry_type === "stock_in" ? "add" : r.entry_type === "wastage" ? "wastage" : (Number(r.qty_delta) > 0 ? "add" : "wastage"),
      qty: Math.abs(Number(r.qty_delta)),
      unit: r.shop_kind === "grocery" ? (r.p_unit ?? "piece") : "pcs",
      ...(r.purchase_rate_paisa !== null && r.purchase_rate_paisa !== undefined ? { rate: r.purchase_rate_paisa / 100 } : {}),
      ...(r.supplier_name_snapshot ? { supplier: r.supplier_name_snapshot } : {}),
      ...(r.reason ? { reason: r.reason } : {}),
      ...(r.expiry ? { expiry: r.expiry } : {}),
      by: r.by_name ?? "System",
    }));
}
