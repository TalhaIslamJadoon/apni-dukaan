// Owner catalogue administration (plan §4.3E): menu items, grocery heads /
// sub-heads / products / variants / packings. Delete-if-empty for heads and
// sub-heads is enforced here; catalogue rows that appear in order history
// are deactivated, never hard-deleted.
import { tx, q, one, ApiError, paisa, rupees } from "../db";
import { emit } from "../events";
import { setStockAbsolute } from "./inventory";
import { shopIdByKind } from "../dto";
import type { StaffPrincipal } from "../auth";

async function changed(shopId: string | null) {
  await tx(async (c) => { await emit(c, "catalog.changed", "catalog", null, { shopId }); });
}

// Business Setup guard: ANY owner grocery-catalogue mutation marks the
// catalogue as owner-saved — from then on retail templates never seed
// over it (server/services/templates.ts catalogueSeedable).
async function markCatalogueCustomized() {
  await q("UPDATE system_settings SET catalogue_customized = true, updated_at = now() WHERE id = true AND catalogue_customized = false");
}

// ── Canteen menu ─────────────────────────────────────────────────────────────
export async function upsertMenuItem(input: {
  id?: string; name: string; price: number; category: string; emoji: string;
  image?: string; sku?: string; stock?: number; lowStock?: number;
  cost?: number | null; // Lagat (Rs) for P&L — null/undefined = not filled
}, staff: StaffPrincipal): Promise<Record<string, unknown>> {
  const shopId = await shopIdByKind("canteen");
  const cat = await one<any>("SELECT id FROM canteen_categories WHERE shop_id = $1 AND name = $2", [shopId, input.category]);
  if (!cat) throw new ApiError(400, "BAD_CATEGORY", "Category nahi mili");
  const costPaisa = input.cost !== undefined && input.cost !== null && input.cost > 0 ? paisa(input.cost) : null;
  let itemId: string;
  if (input.id) {
    const ex = await one<any>("SELECT id FROM menu_items WHERE legacy_id = $1 OR id::text = $1", [input.id]);
    if (!ex) throw new ApiError(404, "ITEM_NOT_FOUND", "Item nahi mila");
    itemId = ex.id;
    await q(
      `UPDATE menu_items SET name=$2, price_paisa=$3, category_id=$4, emoji=$5, image_url=$6, sku=$7,
         low_stock_qty=$8, cost_paisa=$9, is_active=true, updated_at=now(), version=version+1 WHERE id=$1`,
      [itemId, input.name, paisa(input.price), cat.id, input.emoji, input.image ?? null, input.sku ?? null, input.lowStock ?? 5, costPaisa]
    );
  } else {
    const legacy = `item-${Date.now().toString(36)}`;
    const ins = await q<{ id: string }>(
      `INSERT INTO menu_items (legacy_id, shop_id, category_id, name, price_paisa, emoji, image_url, sku, low_stock_qty, cost_paisa)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [legacy, shopId, cat.id, input.name, paisa(input.price), input.emoji, input.image ?? null, input.sku ?? null, input.lowStock ?? 5, costPaisa]
    );
    itemId = ins[0].id;
    await q("INSERT INTO inventory_balances (shop_id, menu_item_id, quantity_on_hand) VALUES ($1,$2,0)", [shopId, itemId]);
  }
  if (input.stock !== undefined) {
    await tx(async (c) => { await setStockAbsolute(c, "canteen", itemId, input.stock!, staff, "Owner menu stock edit"); });
  }
  await changed(shopId);
  return { id: itemId };
}

export async function deleteMenuItem(id: string): Promise<void> {
  const ex = await one<any>("SELECT id FROM menu_items WHERE legacy_id = $1 OR id::text = $1", [id]);
  if (!ex) throw new ApiError(404, "ITEM_NOT_FOUND", "Item nahi mila");
  const used = await one<any>("SELECT 1 FROM order_lines WHERE menu_item_id = $1 LIMIT 1", [ex.id]);
  if (used) await q("UPDATE menu_items SET is_active = false, updated_at = now() WHERE id = $1", [ex.id]);
  else {
    await q("DELETE FROM inventory_balances WHERE menu_item_id = $1", [ex.id]);
    await q("DELETE FROM menu_items WHERE id = $1", [ex.id]);
  }
  await changed(null);
}

// ── Grocery heads / sub-heads ────────────────────────────────────────────────
export async function upsertHead(input: { id?: string; name: string; emoji: string; tint: string; image?: string }): Promise<Record<string, unknown>> {
  await markCatalogueCustomized();
  const shopId = await shopIdByKind("grocery");
  if (input.id) {
    const ex = await one<any>("SELECT id FROM grocery_heads WHERE legacy_id = $1 OR id::text = $1", [input.id]);
    if (!ex) throw new ApiError(404, "HEAD_NOT_FOUND", "Head nahi mila");
    await q("UPDATE grocery_heads SET name=$2, emoji=$3, tint=$4, image_url=$5, updated_at=now(), version=version+1 WHERE id=$1",
      [ex.id, input.name, input.emoji, input.tint, input.image ?? null]);
    await changed(shopId);
    return { id: ex.id };
  }
  const legacy = `head-${Date.now().toString(36)}`;
  const ins = await q<{ id: string }>(
    "INSERT INTO grocery_heads (legacy_id, shop_id, name, emoji, tint, image_url) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
    [legacy, shopId, input.name, input.emoji, input.tint, input.image ?? null]
  );
  await changed(shopId);
  return { id: ins[0].id, legacyId: legacy };
}

export async function deleteHead(id: string): Promise<void> {
  await markCatalogueCustomized();
  const ex = await one<any>("SELECT id FROM grocery_heads WHERE legacy_id = $1 OR id::text = $1", [id]);
  if (!ex) throw new ApiError(404, "HEAD_NOT_FOUND", "Head nahi mila");
  const cnt = await one<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM grocery_products p JOIN grocery_sub_heads s ON s.id = p.sub_head_id WHERE s.head_id = $1 AND p.is_active = true`,
    [ex.id]
  );
  if ((cnt?.n ?? 0) > 0) throw new ApiError(409, "HEAD_NOT_EMPTY", "Head khali nahi hai — pehle products shift/delete karein");
  await q("DELETE FROM grocery_sub_heads WHERE head_id = $1", [ex.id]);
  await q("DELETE FROM grocery_heads WHERE id = $1", [ex.id]);
  await changed(null);
}

export async function upsertSubHead(input: { id?: string; headId: string; name: string; image?: string }): Promise<Record<string, unknown>> {
  await markCatalogueCustomized();
  const head = await one<any>("SELECT id, legacy_id FROM grocery_heads WHERE legacy_id = $1 OR id::text = $1", [input.headId]);
  if (!head) throw new ApiError(404, "HEAD_NOT_FOUND", "Head nahi mila");
  if (input.id) {
    const ex = await one<any>("SELECT id FROM grocery_sub_heads WHERE legacy_id = $1 OR id::text = $1", [input.id]);
    if (!ex) throw new ApiError(404, "SUB_NOT_FOUND", "Sub-head nahi mila");
    await q("UPDATE grocery_sub_heads SET name=$2, image_url=$3, head_id=$4, updated_at=now(), version=version+1 WHERE id=$1",
      [ex.id, input.name, input.image ?? null, head.id]);
    await changed(null);
    return { id: ex.id };
  }
  const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const legacy = `${head.legacy_id ?? "head"}:${slug}-${Date.now().toString(36)}`;
  const ins = await q<{ id: string }>(
    "INSERT INTO grocery_sub_heads (legacy_id, head_id, name, image_url) VALUES ($1,$2,$3,$4) RETURNING id",
    [legacy, head.id, input.name, input.image ?? null]
  );
  await changed(null);
  return { id: ins[0].id, legacyId: legacy };
}

export async function deleteSubHead(id: string): Promise<void> {
  await markCatalogueCustomized();
  const ex = await one<any>("SELECT id FROM grocery_sub_heads WHERE legacy_id = $1 OR id::text = $1", [id]);
  if (!ex) throw new ApiError(404, "SUB_NOT_FOUND", "Sub-head nahi mila");
  const cnt = await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM grocery_products WHERE sub_head_id = $1 AND is_active = true", [ex.id]);
  if ((cnt?.n ?? 0) > 0) throw new ApiError(409, "SUB_NOT_EMPTY", "Sub-head khali nahi hai — pehle products shift/delete karein");
  await q("DELETE FROM grocery_sub_heads WHERE id = $1", [ex.id]);
  await changed(null);
}

// ── Grocery products / variants / packings ───────────────────────────────────
export interface ProductInput {
  id?: string;
  name: string;
  brand?: string;
  subId: string;
  sku: string;
  barcode?: string;
  retailPrice: number;
  wholesalePrice: number;
  wholesaleMinQty?: number;
  stock?: number;
  unit: "piece" | "kg";
  lowStock?: number;
  boardOffer?: boolean;
  offerPrice?: number; // Rs — real offer price; stored only when > 0, else NULL (no offer)
  trackSerial?: boolean; // mobile shops: bikri par har unit ka IMEI/serial lazmi
  emoji: string;
  image?: string;
  packings?: { label: string; retailPrice: number; wholesalePrice: number; barcode?: string; wholesaleMinQty?: number; containsQty?: number }[];
}

export async function upsertProduct(input: ProductInput, staff: StaffPrincipal): Promise<Record<string, unknown>> {
  await markCatalogueCustomized();
  const sub = await one<any>("SELECT id FROM grocery_sub_heads WHERE legacy_id = $1 OR id::text = $1", [input.subId]);
  if (!sub) throw new ApiError(400, "BAD_SUBHEAD", "Product kisi valid Sub-Head ke baghair save nahi ho sakta");
  const shopId = await shopIdByKind("grocery");
  let productId: string;
  if (input.id) {
    const ex = await one<any>("SELECT id FROM grocery_products WHERE legacy_id = $1 OR id::text = $1", [input.id]);
    if (!ex) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Product nahi mila");
    productId = ex.id;
    await q(
      `UPDATE grocery_products SET name=$2, brand=$3, sub_head_id=$4, sku=$5, barcode=$6, unit=$7,
         retail_price_paisa=$8, wholesale_price_paisa=$9, low_stock_qty=$10, emoji=$11, image_url=$12,
         wholesale_min_qty=$13, board_offer=$14, offer_price_paisa=$15, track_serial=$16, is_active=true, updated_at=now(), version=version+1 WHERE id=$1`,
      [productId, input.name, input.brand ?? null, sub.id, input.sku, input.barcode ?? null, input.unit,
       paisa(input.retailPrice), paisa(input.wholesalePrice), input.lowStock ?? (input.unit === "kg" ? 2 : 5), input.emoji, input.image ?? null,
       input.wholesaleMinQty ?? null, input.boardOffer ?? false,
       input.offerPrice && input.offerPrice > 0 ? paisa(input.offerPrice) : null, input.trackSerial ?? false]
    );
  } else {
    const legacy = `p-${input.sku}`;
    const ins = await q<{ id: string }>(
      `INSERT INTO grocery_products (legacy_id, sub_head_id, name, brand, sku, barcode, unit, retail_price_paisa, wholesale_price_paisa, wholesale_min_qty, low_stock_qty, emoji, image_url, board_offer, offer_price_paisa, track_serial)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [legacy, sub.id, input.name, input.brand ?? null, input.sku, input.barcode ?? null, input.unit,
       paisa(input.retailPrice), paisa(input.wholesalePrice), input.wholesaleMinQty ?? null, input.lowStock ?? (input.unit === "kg" ? 2 : 5), input.emoji, input.image ?? null, input.boardOffer ?? false,
       input.offerPrice && input.offerPrice > 0 ? paisa(input.offerPrice) : null, input.trackSerial ?? false]
    );
    productId = ins[0].id;
    await q("INSERT INTO inventory_balances (shop_id, grocery_product_id, quantity_on_hand) VALUES ($1,$2,0)", [shopId, productId]);
    await q("INSERT INTO grocery_variants (product_id, name) VALUES ($1,'Standard')", [productId]);
  }
  if (input.packings) {
    // The Phase 1 form edits the Standard variant's packings as a full set.
    const v = await one<any>("SELECT id FROM grocery_variants WHERE product_id = $1 ORDER BY (name='Standard') DESC, sort_order LIMIT 1", [productId]);
    if (v) {
      await q("DELETE FROM grocery_packings WHERE variant_id = $1", [v.id]);
      for (let i = 0; i < input.packings.length; i++) {
        const pk = input.packings[i];
        await q(
          "INSERT INTO grocery_packings (variant_id, label, contains_qty, barcode, retail_price_paisa, wholesale_price_paisa, wholesale_min_qty, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
          [v.id, pk.label, pk.containsQty ?? 1, pk.barcode ?? null, paisa(pk.retailPrice), paisa(pk.wholesalePrice), pk.wholesaleMinQty ?? null, i]
        );
      }
    }
  }
  if (input.stock !== undefined) {
    await tx(async (c) => { await setStockAbsolute(c, "grocery", productId, input.stock!, staff, "Owner product stock edit"); });
  }
  await changed(shopId);
  return { id: productId };
}

export async function deleteProduct(id: string): Promise<void> {
  await markCatalogueCustomized();
  const ex = await one<any>("SELECT id FROM grocery_products WHERE legacy_id = $1 OR id::text = $1", [id]);
  if (!ex) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Product nahi mila");
  const used = await one<any>("SELECT 1 FROM order_lines WHERE grocery_product_id = $1 LIMIT 1", [ex.id]);
  if (used) await q("UPDATE grocery_products SET is_active = false, updated_at = now() WHERE id = $1", [ex.id]);
  else {
    await q("DELETE FROM inventory_balances WHERE grocery_product_id = $1", [ex.id]);
    await q("DELETE FROM grocery_products WHERE id = $1", [ex.id]); // variants/packings cascade
  }
  await changed(null);
}

export async function upsertVariant(input: { id?: string; productId: string; name: string }): Promise<Record<string, unknown>> {
  await markCatalogueCustomized();
  const prod = await one<any>("SELECT id FROM grocery_products WHERE legacy_id = $1 OR id::text = $1", [input.productId]);
  if (!prod) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Product nahi mila");
  if (input.id) {
    const ex = await one<any>("SELECT id FROM grocery_variants WHERE legacy_id = $1 OR id::text = $1", [input.id]);
    if (!ex) throw new ApiError(404, "VARIANT_NOT_FOUND", "Variant nahi mila");
    await q("UPDATE grocery_variants SET name=$2, updated_at=now(), version=version+1 WHERE id=$1", [ex.id, input.name]);
    await changed(null);
    return { id: ex.id };
  }
  const ins = await q<{ id: string }>(
    "INSERT INTO grocery_variants (product_id, name) VALUES ($1,$2) RETURNING id",
    [prod.id, input.name]
  );
  await changed(null);
  return { id: ins[0].id };
}

export async function deleteVariant(id: string): Promise<void> {
  await markCatalogueCustomized();
  const ex = await one<any>("SELECT id, name FROM grocery_variants WHERE legacy_id = $1 OR id::text = $1", [id]);
  if (!ex) throw new ApiError(404, "VARIANT_NOT_FOUND", "Variant nahi mila");
  const used = await one<any>("SELECT 1 FROM order_lines WHERE grocery_variant_id = $1 LIMIT 1", [ex.id]);
  if (used) await q("UPDATE grocery_variants SET is_active = false WHERE id = $1", [ex.id]);
  else await q("DELETE FROM grocery_variants WHERE id = $1", [ex.id]);
  await changed(null);
}

export async function upsertPacking(input: {
  id?: string; variantId: string; label: string; retailPrice: number; wholesalePrice: number; barcode?: string; stock?: number; wholesaleMinQty?: number; containsQty?: number;
}): Promise<Record<string, unknown>> {
  await markCatalogueCustomized();
  const v = await one<any>("SELECT id FROM grocery_variants WHERE legacy_id = $1 OR id::text = $1", [input.variantId]);
  if (!v) throw new ApiError(404, "VARIANT_NOT_FOUND", "Variant nahi mila");
  if (input.id) {
    const ex = await one<any>("SELECT id FROM grocery_packings WHERE id::text = $1", [input.id]);
    if (!ex) throw new ApiError(404, "PACKING_NOT_FOUND", "Packing nahi mili");
    await q(
      "UPDATE grocery_packings SET label=$2, barcode=$3, retail_price_paisa=$4, wholesale_price_paisa=$5, stock_qty=$6, wholesale_min_qty=$7, contains_qty=$8, updated_at=now(), version=version+1 WHERE id=$1",
      [ex.id, input.label, input.barcode ?? null, paisa(input.retailPrice), paisa(input.wholesalePrice), input.stock ?? null, input.wholesaleMinQty ?? null, input.containsQty ?? 1]
    );
    await changed(null);
    return { id: ex.id };
  }
  const ins = await q<{ id: string }>(
    "INSERT INTO grocery_packings (variant_id, label, contains_qty, barcode, retail_price_paisa, wholesale_price_paisa, stock_qty, wholesale_min_qty) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
    [v.id, input.label, input.containsQty ?? 1, input.barcode ?? null, paisa(input.retailPrice), paisa(input.wholesalePrice), input.stock ?? null, input.wholesaleMinQty ?? null]
  );
  await changed(null);
  return { id: ins[0].id };
}

export async function deletePacking(id: string): Promise<void> {
  await markCatalogueCustomized();
  const ex = await one<any>("SELECT id FROM grocery_packings WHERE id::text = $1", [id]);
  if (!ex) throw new ApiError(404, "PACKING_NOT_FOUND", "Packing nahi mili");
  const used = await one<any>("SELECT 1 FROM order_lines WHERE grocery_packing_id = $1 LIMIT 1", [ex.id]);
  if (used) await q("UPDATE grocery_packings SET is_active = false WHERE id = $1", [ex.id]);
  else await q("DELETE FROM grocery_packings WHERE id = $1", [ex.id]);
  await changed(null);
}

export { rupees };
