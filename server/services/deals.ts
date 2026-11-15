// ─────────────────────────────────────────────────────────────────────────────
// Canteen Deals — owner CRUD (KFC-style combos). A deal is a named bundle
// of menu items at ONE deal price; selling it creates ONE order line whose
// components snapshot is frozen at order time (see services/orders.ts).
// Deletes are hard deletes of the deal definition only — past order lines
// keep their snapshots, so history and P&L never break.
// ─────────────────────────────────────────────────────────────────────────────
import { tx, one, ApiError, paisa } from "../db";
import { emit, audit } from "../events";
import { fetchDealDTOs, shopIdByKind } from "../dto";
import type { StaffPrincipal } from "../auth";

export interface DealInput {
  name: string;
  price: number; // Rs
  active: boolean;
  items: { menuItemId: string; qty: number }[];
}

function validate(input: DealInput) {
  if (!input.name?.trim()) throw new ApiError(400, "DEAL_NAME_REQUIRED", "Deal ka naam likhein");
  if (!(input.price > 0)) throw new ApiError(400, "DEAL_PRICE_REQUIRED", "Deal Price sahi likhein (0 se zyada)");
  if (!input.items?.length) throw new ApiError(400, "DEAL_ITEMS_REQUIRED", "Deal mein kam az kam ek item shamil karein");
  for (const it of input.items) if (!(it.qty > 0)) throw new ApiError(400, "DEAL_BAD_QTY", "Deal item ki qty ghalat hai");
}

async function resolveItems(c: import("pg").PoolClient, items: DealInput["items"]) {
  const out: { menuItemId: string; qty: number }[] = [];
  for (const it of items) {
    const m = await one<any>("SELECT id FROM menu_items WHERE legacy_id = $1 OR id::text = $1", [it.menuItemId]);
    if (!m) throw new ApiError(400, "ITEM_NOT_FOUND", `Menu item nahi mila: ${it.menuItemId}`);
    out.push({ menuItemId: m.id, qty: it.qty });
  }
  return out;
}

export async function createDeal(input: DealInput, staff: StaffPrincipal): Promise<Record<string, unknown>> {
  validate(input);
  const shopId = await shopIdByKind("canteen");
  const legacy = `deal-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  const id = await tx(async (c) => {
    const items = await resolveItems(c, input.items);
    const ins = await c.query(
      "INSERT INTO deals (legacy_id, shop_id, name, price_paisa, is_active) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [legacy, shopId, input.name.trim(), paisa(input.price), input.active]
    );
    const dealId = ins.rows[0].id as string;
    for (let i = 0; i < items.length; i++) {
      await c.query("INSERT INTO deal_items (deal_id, menu_item_id, qty, sort_order) VALUES ($1,$2,$3,$4)", [dealId, items[i].menuItemId, items[i].qty, i]);
    }
    await emit(c, "catalog.changed", "catalog", null, { shopId });
    await audit(c, { type: "staff", staffId: staff.id }, "deal.create", "deal", dealId, { name: input.name, price: input.price });
    return dealId;
  });
  const all = (await fetchDealDTOs()) as Record<string, unknown>[];
  return all.find((d) => d.id === legacy) ?? { id: legacy };
}

export async function updateDeal(id: string, input: DealInput, staff: StaffPrincipal): Promise<Record<string, unknown>> {
  validate(input);
  await tx(async (c) => {
    const ex = (await c.query("SELECT * FROM deals WHERE legacy_id = $1 OR id::text = $1 FOR UPDATE", [id])).rows[0];
    if (!ex) throw new ApiError(404, "DEAL_NOT_FOUND", "Deal nahi mili");
    const items = await resolveItems(c, input.items);
    await c.query(
      "UPDATE deals SET name = $2, price_paisa = $3, is_active = $4, updated_at = now(), version = version + 1 WHERE id = $1",
      [ex.id, input.name.trim(), paisa(input.price), input.active]
    );
    await c.query("DELETE FROM deal_items WHERE deal_id = $1", [ex.id]);
    for (let i = 0; i < items.length; i++) {
      await c.query("INSERT INTO deal_items (deal_id, menu_item_id, qty, sort_order) VALUES ($1,$2,$3,$4)", [ex.id, items[i].menuItemId, items[i].qty, i]);
    }
    await emit(c, "catalog.changed", "catalog", null, { shopId: ex.shop_id });
    await audit(c, { type: "staff", staffId: staff.id }, "deal.update", "deal", ex.id, { name: input.name, price: input.price });
  });
  const all = (await fetchDealDTOs()) as Record<string, unknown>[];
  return all.find((d) => d.id === id) ?? { id };
}

export async function deleteDeal(id: string, staff: StaffPrincipal): Promise<void> {
  await tx(async (c) => {
    const ex = (await c.query("SELECT * FROM deals WHERE legacy_id = $1 OR id::text = $1 FOR UPDATE", [id])).rows[0];
    if (!ex) throw new ApiError(404, "DEAL_NOT_FOUND", "Deal nahi mili");
    // order_lines.deal_id has no cascade — past orders keep existing via
    // their frozen components snapshot; null the FK, then delete.
    await c.query("UPDATE order_lines SET deal_id = NULL WHERE deal_id = $1", [ex.id]);
    await c.query("DELETE FROM deals WHERE id = $1", [ex.id]);
    await emit(c, "catalog.changed", "catalog", null, { shopId: ex.shop_id });
    await audit(c, { type: "staff", staffId: staff.id }, "deal.delete", "deal", ex.id, { name: ex.name });
  });
}
