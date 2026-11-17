// ─────────────────────────────────────────────────────────────────────────────
// Business Setup — retail template seeding (server side).
//
// SEEDING RULE (sakht, Phase 1 parity): a template seeds ONLY when no
// grocery data was ever SAVED in this install:
//   • system_settings.catalogue_customized is false (no owner catalogue
//     mutation through the admin API), AND
//   • no grocery order line exists, AND
//   • no non-opening grocery stock entry exists.
// While only seed/demo data is present the guard passes. Business type
// badalna data ko kabhi delete nahi karta — view gating settings se hota
// hai; the replace below runs only inside this guard, on a catalogue that
// is still the untouched seed.
// Idempotency: system_settings.template_key records the applied template;
// re-saving the same setup is a no-op.
//   • grocery     → built-in catalogue hi is ka seed hai (no-op).
//   • supermarket → built-in catalogue + fresh heads/products (extras are
//                   inserted only when absent; nothing is removed).
//   • other types → the seed catalogue is replaced by the template's demo
//                   catalogue (inside the guard above).
// ─────────────────────────────────────────────────────────────────────────────
import type { PoolClient } from "pg";
import { paisa } from "../db";
import { templateOf, RENTAL_SEED_ITEMS, type TemplateHead, type TemplateProduct } from "../templates-data";
import { shopIdByKind } from "../dto";

const slugifyTpl = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
const TEMPLATE_TINTS = ["#FFFBEB", "#EFF6FF", "#F0FDF4", "#FDF2F8", "#F5F3FF", "#FFF7ED", "#ECFEFF", "#FEF2F2"];

async function catalogueSeedable(c: PoolClient): Promise<boolean> {
  const s = (await c.query("SELECT catalogue_customized FROM system_settings WHERE id = true")).rows[0];
  if (s?.catalogue_customized) return false;
  const lines = await c.query("SELECT 1 FROM order_lines WHERE grocery_product_id IS NOT NULL LIMIT 1");
  if (lines.rows[0]) return false;
  const entries = await c.query(
    `SELECT 1 FROM stock_entries e JOIN inventory_balances b ON b.id = e.inventory_id
     WHERE b.grocery_product_id IS NOT NULL AND e.entry_type <> 'opening' LIMIT 1`
  );
  if (entries.rows[0]) return false;
  return true;
}

interface BuiltCatalogue {
  heads: { legacy: string; name: string; emoji: string; tint: string }[];
  subs: { legacy: string; headLegacy: string; name: string }[];
  products: (TemplateProduct & { legacy: string; headLegacy: string; subLegacy: string })[];
}

// Same id scheme as Phase 1 buildCatalogue: heads `tpl-<key>-<slug>`,
// subs `<headId>:<slug>`, products `tpl-<key>-p<N>`.
function buildCatalogue(key: string, headsIn: TemplateHead[], productsIn: TemplateProduct[]): BuiltCatalogue {
  const heads = headsIn.map((h, i) => ({
    legacy: `tpl-${key}-${slugifyTpl(h.name)}`, name: h.name, emoji: h.emoji,
    tint: TEMPLATE_TINTS[i % TEMPLATE_TINTS.length],
  }));
  const subs: BuiltCatalogue["subs"] = [];
  headsIn.forEach((h, i) => {
    h.subs.forEach((s) => subs.push({ legacy: `${heads[i].legacy}:${slugifyTpl(s)}`, headLegacy: heads[i].legacy, name: s }));
  });
  const products = productsIn.map((p, i) => {
    const head = heads.find((h) => h.name === p.head) ?? heads[0];
    const sub = subs.find((s) => s.headLegacy === head?.legacy && s.name === p.sub)
      ?? subs.find((s) => s.headLegacy === head?.legacy) ?? subs[0];
    return { ...p, legacy: `tpl-${key}-p${i + 1}`, headLegacy: head?.legacy ?? "", subLegacy: sub?.legacy ?? "" };
  });
  return { heads, subs, products };
}

async function insertCatalogue(c: PoolClient, shopId: string, built: BuiltCatalogue): Promise<void> {
  const headIds = new Map<string, string>();
  for (let i = 0; i < built.heads.length; i++) {
    const h = built.heads[i];
    const r = await c.query(
      `INSERT INTO grocery_heads (legacy_id, shop_id, name, emoji, tint, sort_order) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (legacy_id) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [h.legacy, shopId, h.name, h.emoji, h.tint, 100 + i]
    );
    headIds.set(h.legacy, r.rows[0].id);
  }
  const subIds = new Map<string, string>();
  for (let i = 0; i < built.subs.length; i++) {
    const s = built.subs[i];
    const r = await c.query(
      `INSERT INTO grocery_sub_heads (legacy_id, head_id, name, sort_order) VALUES ($1,$2,$3,$4)
       ON CONFLICT (legacy_id) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [s.legacy, headIds.get(s.headLegacy), s.name, i]
    );
    subIds.set(s.legacy, r.rows[0].id);
  }
  for (const p of built.products) {
    const subId = subIds.get(p.subLegacy);
    if (!subId) continue;
    const r = await c.query(
      `INSERT INTO grocery_products (legacy_id, sub_head_id, name, sku, barcode, unit, retail_price_paisa,
         wholesale_price_paisa, low_stock_qty, emoji, track_serial)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (legacy_id) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [p.legacy, subId, p.name, p.sku, p.barcode ?? null, p.unit ?? "piece",
       paisa(p.retailPrice), paisa(p.wholesalePrice), (p.unit ?? "piece") === "kg" ? 2 : 5, p.emoji, !!p.trackSerial]
    );
    const productId = r.rows[0].id as string;
    const v = await c.query(
      `INSERT INTO grocery_variants (product_id, name) VALUES ($1,'Standard')
       ON CONFLICT (product_id, lower(name)) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [productId]
    );
    const variantId = v.rows[0].id;
    for (let i = 0; i < (p.packings ?? []).length; i++) {
      const pk = p.packings![i];
      await c.query(
        `INSERT INTO grocery_packings (variant_id, label, retail_price_paisa, wholesale_price_paisa, sort_order)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (variant_id, lower(label)) DO UPDATE SET retail_price_paisa = EXCLUDED.retail_price_paisa`,
        [variantId, pk.label, paisa(pk.retailPrice), paisa(pk.wholesalePrice), i]
      );
    }
    // Opening stock (template demo quantities) + its opening ledger entry.
    const bal = await c.query("SELECT id FROM inventory_balances WHERE grocery_product_id = $1", [productId]);
    if (!bal.rows[0]) {
      const ins = await c.query(
        "INSERT INTO inventory_balances (shop_id, grocery_product_id, quantity_on_hand) VALUES ($1,$2,$3) RETURNING id",
        [shopId, productId, p.stock]
      );
      if (p.stock > 0) {
        await c.query(
          "INSERT INTO stock_entries (inventory_id, entry_type, qty_delta, qty_after, note) VALUES ($1,'opening',$2,$2,'Template seed opening stock')",
          [ins.rows[0].id, p.stock]
        );
      }
    }
  }
}

async function wipeGroceryCatalogue(c: PoolClient): Promise<void> {
  // Only ever called inside the seedable guard: no grocery order lines and
  // no non-opening entries can exist, so this removes seed data only.
  await c.query(
    `DELETE FROM stock_entries WHERE inventory_id IN
       (SELECT id FROM inventory_balances WHERE grocery_product_id IS NOT NULL)`
  );
  await c.query("DELETE FROM inventory_balances WHERE grocery_product_id IS NOT NULL");
  await c.query("DELETE FROM grocery_products"); // variants + packings cascade
  await c.query("DELETE FROM grocery_sub_heads");
  await c.query("DELETE FROM grocery_heads");
}

/**
 * Apply the retail template for a Business Setup confirm. Runs inside the
 * settings PATCH transaction. Returns what happened for the response.
 */
export async function applyRetailTemplate(
  c: PoolClient,
  retailType: string
): Promise<{ applied: boolean; reason?: string }> {
  const t = templateOf(retailType);
  if (!t) return { applied: false, reason: "UNKNOWN_TEMPLATE" };
  const cur = (await c.query("SELECT template_key FROM system_settings WHERE id = true")).rows[0];
  if (retailType === "clothing" && cur?.template_key !== "clothing") {
    // Kapron ki Dukaan (clothing) PEHLI dafa lag rahi hai: rental wala
    // kaam auto-ON + demo dresses seed (Talha, 18 Nov 2026: rental koi
    // alag type NAHI — kapray wali dukaan ke andar hi hai). Dresses ka
    // guard un ka apna hai (rental_items bilkul khali hon tab hi) —
    // catalogue guard se alag, kyunke dresses grocery data nahi hain aur
    // owner ke items kabhi overwrite nahi hone chahiye. Type pehle se
    // clothing ho to rentals_enabled ko haath NAHI lagta — phir Owner
    // Settings ka toggle hi malik hai (warna dukaan rentals band hi na
    // kar sake). Purani "rental" type wali databases: rentals_enabled
    // pehle se ON hoga, toggle se hi chalta rahega.
    await c.query("UPDATE system_settings SET rentals_enabled = true, updated_at = now() WHERE id = true");
    const cnt = (await c.query("SELECT COUNT(*)::int AS n FROM rental_items")).rows[0];
    if (Number(cnt?.n ?? 0) === 0) {
      for (const d of RENTAL_SEED_ITEMS) {
        await c.query(
          `INSERT INTO rental_items (legacy_id, name, category, total_qty, size, color, rent_per_day_paisa, security_deposit_paisa, emoji, offer_rent_per_day_paisa, board_offer, image_url, image_urls, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'available') ON CONFLICT (legacy_id) DO NOTHING`,
          [d.legacy, d.name, d.category ?? null, d.totalQty ?? 1, d.size ?? null, d.color ?? null, paisa(d.rentPerDay), paisa(d.securityDeposit), d.emoji,
           d.offerRentPerDay ? paisa(d.offerRentPerDay) : null, d.boardOffer === true,
           d.image ?? (d.images?.[0] ?? null), JSON.stringify(d.images ?? (d.image ? [d.image] : []))]
        );
      }
    }
  }
  if (cur?.template_key === retailType) return { applied: false, reason: "ALREADY_APPLIED" };
  if (!(await catalogueSeedable(c))) {
    // Data maujood hai — type sirf VIEW badalta hai, catalogue nahi. The
    // key is still recorded so we never retry a replace against real data.
    await c.query("UPDATE system_settings SET template_key = $1, updated_at = now() WHERE id = true", [retailType]);
    return { applied: false, reason: "CATALOGUE_NOT_EMPTY" };
  }
  const shopId = await shopIdByKind("grocery");
  if (t.key === "grocery") {
    // Built-in catalogue hi is ka seed hai — kuch insert nahi karna.
  } else if (t.key === "supermarket") {
    const extra = buildCatalogue(t.key, t.extraHeads ?? [], t.extraProducts ?? []);
    await insertCatalogue(c, shopId, extra);
  } else {
    const built = buildCatalogue(t.key, t.heads, t.demoProducts);
    if (built.products.length) {
      await wipeGroceryCatalogue(c);
      await insertCatalogue(c, shopId, built);
    }
  }
  await c.query("UPDATE system_settings SET template_key = $1, updated_at = now() WHERE id = true", [retailType]);
  return { applied: true };
}
