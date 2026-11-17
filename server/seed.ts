// Clean reseed (plan §5.2): NO browser-local demo data is migrated. Seeds
// shops, settings, canteen menu, demo staff (same PINs, bcrypt-hashed), the
// 3-level grocery catalogue from lib/catalog-seed.json, opening stock and
// dining tables 1–8. Idempotent: re-running updates seed-owned descriptive
// fields and never duplicates rows or resets balances created earlier
// (unless --force-sample-reset is passed on a non-production database).
//
// Catalogue v3 tolerance: product entries may carry explicit `brand` and
// `variant` fields. Entries sharing (sub-head, brand, master name) with
// different variants group under ONE master product; each entry's packings
// land under its variant. Without a variant field, the product is a master
// with the implicit 'Standard' variant (the Phase 1 shape).
import { PoolClient } from "pg";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { pool, tx, paisa } from "./db";
import catalogSeed from "../lib/catalog-seed.json";
import { SAMPLE_MENU, STAFF_SEED, CATEGORY_STYLE } from "../lib/store";

const FORCE = process.argv.includes("--force-sample-reset");

// ── Brand parsing (only when the seed entry has no explicit brand) ──────────
// Brand/company is part of product identity (Talha): never merge brands.
// Lexicon of brands present in Pakistani FMCG catalogues; longest-prefix
// match on the product name, else NULL (generic/unbranded items).
const BRAND_LEXICON = [
  "Surf Excel", "Head & Shoulders", "Soya Supreme", "Coca-Cola", "Rooh Afza",
  "Peek Freans", "Fair & Lovely", "Glow & Lovely", "Scotch-Brite", "Mr Muscles",
  "Lemon Max", "Bona Papa", "Sunsilk", "Pantene", "Clear", "Dove", "Lux",
  "Lifebuoy", "Dalda", "Tapal", "Nescafe", "Nestle", "Nestlé", "Olpers",
  "Milkpak", "Pepsi", "Pakola", "National", "Shan", "Knorr", "Maggi",
  "Cerelac", "Dawn", "Kolson", "Bisconni", "LU", "Rio", "Prince", "Gala",
  "Vital", "Mezan", "Habib", "Eva", "Sufi", "Rafhan", "Shezan", "Ahmed",
  "Dipitt", "Shangrila", "Nurpur", "Haleeb", "Dayfresh", "Tarang", "Fauji",
  "Walls", "Pampers", "Molfix", "Shield", "Colgate", "Closeup", "Signal",
  "Pepsodent", "Sensodyne", "Palmolive", "Nivea", "Pond's", "Ponds", "Olay",
  "Garnier", "Vatika", "Dabur", "Himalaya", "Johnson's", "Johnsons",
  "Dettol", "Harpic", "Surf", "Bright", "Bonus", "Ariel", "Tide", "Vanish",
  "Comfort", "Downy", "Vim", "Fa", "Super", "Islamabad",
].sort((a, b) => b.length - a.length);

export function parseBrand(name: string): string | null {
  const lower = name.toLowerCase();
  for (const b of BRAND_LEXICON) {
    const bl = b.toLowerCase();
    if (lower === bl || lower.startsWith(bl + " ")) return b;
  }
  return null;
}

interface SeedPacking { label: string; retailPrice: number; wholesalePrice: number; barcode?: string; wholesaleMinQty?: number; stock?: number; containsQty?: number }
interface SeedProduct {
  id: string; name: string; sku: string; barcode?: string;
  retailPrice: number; wholesalePrice: number; stock: number;
  unit: "piece" | "kg"; emoji: string; image?: string; images?: string[];
  brand?: string; variant?: string; wholesaleMinQty?: number;
  packings?: SeedPacking[];
}
interface SeedSub { id: string; name: string; image?: string; products: SeedProduct[] }
interface SeedHead { id: string; name: string; emoji: string; image?: string; subs: SeedSub[] }

const HEAD_TINTS = [
  "#FFFBEB", "#FEF9C3", "#FDF2F8", "#EFF6FF", "#F0FDF4",
  "#FFF7ED", "#FEF2F2", "#FDF4FF", "#ECFEFF", "#E0F2FE",
  "#F5F3FF", "#FDF2F8", "#F0FDF4", "#E0F2FE", "#F5F3FF",
  "#FFFBEB", "#EFF6FF", "#FEF9C3", "#FEF2F2", "#F5F5F4",
];

async function seedShops(c: PoolClient): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const [kind, name] of [["canteen", "College Canteen"], ["grocery", "Campus Grocery Store"]] as const) {
    const r = await c.query(
      `INSERT INTO shops (kind, display_name) VALUES ($1,$2)
       ON CONFLICT (kind) DO UPDATE SET display_name = shops.display_name RETURNING id`,
      [kind, name]
    );
    ids[kind] = r.rows[0].id;
  }
  await c.query(
    `UPDATE system_settings SET jazzcash_number = COALESCE(jazzcash_number, '03XX-XXXXXXX (demo)'),
       easypaisa_number = COALESCE(easypaisa_number, '03XX-XXXXXXX (demo)'),
       raast_info = COALESCE(raast_info, '03XX-XXXXXXX (demo Raast ID)') WHERE id = true`
  );
  return ids;
}

async function seedStaff(c: PoolClient): Promise<void> {
  for (const s of STAFF_SEED) {
    const hash = await bcrypt.hash(s.pin, 10);
    const r = await c.query(
      `INSERT INTO staff_users (legacy_id, display_name, credential_hash, credential_kind, is_owner)
       VALUES ($1,$2,$3,'pin4',$4)
       ON CONFLICT (legacy_id) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
      [s.id, s.name, hash, !!s.isOwner]
    );
    const uid = r.rows[0].id;
    for (const tab of s.tabs) {
      await c.query(
        "INSERT INTO staff_tab_grants (staff_user_id, tab_key, granted_by_staff_id) VALUES ($1,$2,$1) ON CONFLICT DO NOTHING",
        [uid, tab]
      );
    }
  }
}

async function seedMenu(c: PoolClient, shopId: string): Promise<number> {
  const cats = Object.keys(CATEGORY_STYLE);
  const catIds: Record<string, string> = {};
  for (let i = 0; i < cats.length; i++) {
    const st = CATEGORY_STYLE[cats[i] as keyof typeof CATEGORY_STYLE];
    const r = await c.query(
      `INSERT INTO canteen_categories (shop_id, legacy_key, name, bg_color, ring_color, chip_color, sort_order)
       VALUES ($1,$2,$2,$3,$4,$5,$6)
       ON CONFLICT (shop_id, legacy_key) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [shopId, cats[i], st.bg, st.ring, st.chip, i]
    );
    catIds[cats[i]] = r.rows[0].id;
  }
  let n = 0;
  for (let i = 0; i < SAMPLE_MENU.length; i++) {
    const m = SAMPLE_MENU[i];
    const r = await c.query(
      `INSERT INTO menu_items (legacy_id, shop_id, category_id, name, price_paisa, emoji, image_url, sku, low_stock_qty, sort_order, image_urls)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (legacy_id) DO UPDATE SET name = EXCLUDED.name, price_paisa = EXCLUDED.price_paisa,
         emoji = EXCLUDED.emoji, image_url = EXCLUDED.image_url, image_urls = EXCLUDED.image_urls RETURNING id`,
      [m.id, shopId, catIds[m.category], m.name, paisa(m.price), m.emoji, m.image ?? null, m.sku ?? null, m.lowStock ?? 5, i,
       JSON.stringify(m.images?.length ? m.images : (m.image ? [m.image] : []))]
    );
    await seedBalance(c, shopId, { menuItemId: r.rows[0].id }, m.stock ?? 50);
    n++;
  }
  return n;
}

async function seedBalance(
  c: PoolClient, shopId: string,
  ref: { menuItemId?: string; productId?: string },
  openingQty: number
): Promise<void> {
  const col = ref.menuItemId ? "menu_item_id" : "grocery_product_id";
  const val = ref.menuItemId ?? ref.productId!;
  const existing = await c.query(`SELECT id, quantity_on_hand FROM inventory_balances WHERE ${col} = $1`, [val]);
  if (!existing.rows[0]) {
    const ins = await c.query(
      `INSERT INTO inventory_balances (shop_id, ${col}, quantity_on_hand) VALUES ($1,$2,$3) RETURNING id`,
      [shopId, val, openingQty]
    );
    if (openingQty > 0) {
      await c.query(
        "INSERT INTO stock_entries (inventory_id, entry_type, qty_delta, qty_after, note) VALUES ($1,'opening',$2,$2,'Seed opening stock')",
        [ins.rows[0].id, openingQty]
      );
    }
  } else if (FORCE) {
    await c.query("UPDATE inventory_balances SET quantity_on_hand = $2 WHERE id = $1", [existing.rows[0].id, openingQty]);
  }
}

interface MasterGroup {
  masterLegacy: string;
  name: string;
  brand: string | null;
  first: SeedProduct;
  variants: Map<string, { packings: SeedPacking[] }>;
}

// Demo products flagged for the Menu Board "🎉 Aaj ki Offers" slide
// (same four as the Phase 1 seed): Surf Excel · Peek Freans Rio ·
// Coca-Cola · Cadbury Dairy Milk. Matched by SKU.
const BOARD_OFFER_SKUS = new Set(["14101", "08106", "10101", "12101"]);

// One seeded item also carries a REAL offer price (same as Phase 1) so the
// dual-rate board display + offer billing are visible on a fresh seed:
// Peek Freans Rio retail Rs 80 → offer Rs 70. Matched by SKU, Rs.
const OFFER_PRICE_BY_SKU: Record<string, number> = { "08106": 70 };

async function seedGrocery(c: PoolClient, shopId: string): Promise<{ heads: number; subs: number; products: number; variants: number; packings: number }> {
  const heads = (catalogSeed as unknown as { heads: SeedHead[] }).heads;
  let nHeads = 0, nSubs = 0, nProducts = 0, nVariants = 0, nPackings = 0;
  for (let hi = 0; hi < heads.length; hi++) {
    const h = heads[hi];
    const hr = await c.query(
      `INSERT INTO grocery_heads (legacy_id, shop_id, name, emoji, tint, image_url, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (legacy_id) DO UPDATE SET name = EXCLUDED.name, emoji = EXCLUDED.emoji, image_url = EXCLUDED.image_url RETURNING id`,
      [h.id, shopId, h.name, h.emoji, HEAD_TINTS[hi % HEAD_TINTS.length], h.image ?? null, hi]
    );
    const headId = hr.rows[0].id;
    nHeads++;
    for (let si = 0; si < h.subs.length; si++) {
      const s = h.subs[si];
      const subLegacy = `${h.id}:${s.id}`;
      const sr = await c.query(
        `INSERT INTO grocery_sub_heads (legacy_id, head_id, name, image_url, sort_order)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (legacy_id) DO UPDATE SET name = EXCLUDED.name, image_url = EXCLUDED.image_url RETURNING id`,
        [subLegacy, headId, s.name, s.image ?? null, si]
      );
      const subId = sr.rows[0].id;
      nSubs++;

      // Group entries into masters: (brand, master name) — variants under a
      // master. v3 entries carry explicit brand + variant; if the entry name
      // still ends with the variant text, strip it to get the master name.
      const groups = new Map<string, MasterGroup>();
      for (const p of s.products) {
        const brand = p.brand ?? parseBrand(p.name);
        let masterName = p.name;
        if (p.variant && masterName.toLowerCase().endsWith(p.variant.toLowerCase())) {
          masterName = masterName.slice(0, masterName.length - p.variant.length).trim().replace(/[-–—·]+$/, "").trim() || p.name;
        }
        const key = `${brand ?? ""}|${masterName.toLowerCase()}`;
        let g = groups.get(key);
        if (!g) {
          g = { masterLegacy: p.id, name: masterName, brand, first: p, variants: new Map() };
          groups.set(key, g);
        }
        const variantName = p.variant?.trim() || "Standard";
        if (!g.variants.has(variantName)) g.variants.set(variantName, { packings: [] });
        g.variants.get(variantName)!.packings.push(...(p.packings ?? []));
      }

      for (const g of groups.values()) {
        const p = g.first;
        const pr = await c.query(
          `INSERT INTO grocery_products (legacy_id, sub_head_id, name, brand, sku, barcode, unit,
             retail_price_paisa, wholesale_price_paisa, wholesale_min_qty, low_stock_qty, emoji, image_url, board_offer, offer_price_paisa, image_urls)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           ON CONFLICT (legacy_id) DO UPDATE SET name = EXCLUDED.name, brand = EXCLUDED.brand,
             retail_price_paisa = EXCLUDED.retail_price_paisa, wholesale_price_paisa = EXCLUDED.wholesale_price_paisa,
             image_url = EXCLUDED.image_url, board_offer = EXCLUDED.board_offer, offer_price_paisa = EXCLUDED.offer_price_paisa,
             image_urls = EXCLUDED.image_urls RETURNING id`,
          [g.masterLegacy, subId, g.name, g.brand, p.sku, p.barcode ?? null, p.unit,
           paisa(p.retailPrice), paisa(p.wholesalePrice), p.wholesaleMinQty ?? null,
           p.unit === "kg" ? 2 : 5, p.emoji, p.image ?? null, BOARD_OFFER_SKUS.has(p.sku),
           OFFER_PRICE_BY_SKU[p.sku] ? paisa(OFFER_PRICE_BY_SKU[p.sku]) : null,
           JSON.stringify(p.images?.length ? p.images : (p.image ? [p.image] : []))]
        );
        const productId = pr.rows[0].id;
        nProducts++;
        await seedBalance(c, shopId, { productId }, p.stock);
        let vi = 0;
        for (const [variantName, vdata] of g.variants) {
          const vLegacy = variantName === "Standard" ? null : `${g.masterLegacy}:${variantName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
          const vr = await c.query(
            `INSERT INTO grocery_variants (legacy_id, product_id, name, sort_order)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (product_id, lower(name)) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
            [vLegacy, productId, variantName, vi++]
          );
          const variantId = vr.rows[0].id;
          nVariants++;
          for (let pi = 0; pi < vdata.packings.length; pi++) {
            const pk = vdata.packings[pi];
            await c.query(
              `INSERT INTO grocery_packings (variant_id, label, contains_qty, barcode, retail_price_paisa, wholesale_price_paisa, wholesale_min_qty, stock_qty, sort_order)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
               ON CONFLICT (variant_id, lower(label)) DO UPDATE SET barcode = EXCLUDED.barcode, contains_qty = EXCLUDED.contains_qty,
                 retail_price_paisa = EXCLUDED.retail_price_paisa, wholesale_price_paisa = EXCLUDED.wholesale_price_paisa`,
              [variantId, pk.label, pk.containsQty ?? 1, pk.barcode ?? null, paisa(pk.retailPrice), paisa(pk.wholesalePrice), pk.wholesaleMinQty ?? null, pk.stock ?? null, pi]
            );
            nPackings++;
          }
        }
      }
    }
  }
  return { heads: nHeads, subs: nSubs, products: nProducts, variants: nVariants, packings: nPackings };
}

// Demo deals (Phase 1 SAMPLE_DEALS ke wohi 2): Student Deal Rs 600 aur
// Family Deal Rs 850. SEEDING RULE: sirf EK dafa — system_settings
// .deals_seeded marker. Owner saari deals delete kar de to list khali
// rehti hai; seed dobara chalane se deals wapas NAHI atin.
const SEED_DEALS = [
  { legacy: "deal-student", name: "Student Deal", price: 600, items: [["fast-2", 1], ["fast-4", 1], ["cold-1", 1]] as [string, number][] },
  { legacy: "deal-family", name: "Family Deal", price: 850, items: [["fast-5", 2], ["fast-6", 1], ["cold-2", 1]] as [string, number][] },
];

async function seedDeals(c: PoolClient, shopId: string): Promise<number> {
  const s = (await c.query("SELECT deals_seeded FROM system_settings WHERE id = true")).rows[0];
  if (s?.deals_seeded) return 0;
  const existing = await c.query("SELECT COUNT(*)::int AS n FROM deals");
  if ((existing.rows[0]?.n ?? 0) === 0) {
    for (let di = 0; di < SEED_DEALS.length; di++) {
      const d = SEED_DEALS[di];
      const ins = await c.query(
        "INSERT INTO deals (legacy_id, shop_id, name, price_paisa, is_active, sort_order) VALUES ($1,$2,$3,$4,true,$5) RETURNING id",
        [d.legacy, shopId, d.name, paisa(d.price), di]
      );
      for (let i = 0; i < d.items.length; i++) {
        const [legacy, qty] = d.items[i];
        await c.query(
          `INSERT INTO deal_items (deal_id, menu_item_id, qty, sort_order)
           SELECT $1, id, $3, $4 FROM menu_items WHERE legacy_id = $2`,
          [ins.rows[0].id, legacy, qty, i]
        );
      }
    }
  }
  await c.query("UPDATE system_settings SET deals_seeded = true WHERE id = true");
  const after = await c.query("SELECT COUNT(*)::int AS n FROM deals");
  return after.rows[0]?.n ?? 0;
}

async function seedTables(c: PoolClient, shopId: string): Promise<void> {
  for (let n = 1; n <= 8; n++) {
    const token = crypto.randomBytes(18).toString("hex");
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    await c.query(
      `INSERT INTO dining_tables (shop_id, table_no, label, public_token_hash)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (shop_id, table_no) DO UPDATE SET public_token_hash = COALESCE(dining_tables.public_token_hash, EXCLUDED.public_token_hash)`,
      [shopId, n, `Table ${n}`, hash]
    );
  }
}

async function main() {
  const counts = await tx(async (c) => {
    const shops = await seedShops(c);
    await seedStaff(c);
    const menuCount = await seedMenu(c, shops.canteen);
    const g = await seedGrocery(c, shops.grocery);
    const dealCount = await seedDeals(c, shops.canteen);
    await seedTables(c, shops.canteen);
    return { menuCount, g, dealCount };
  });
  console.log(`[seed] menu items: ${counts.menuCount}`);
  console.log(`[seed] deals in db: ${counts.dealCount}`);
  console.log(`[seed] grocery: ${counts.g.heads} heads, ${counts.g.subs} sub-heads, ${counts.g.products} products (masters), ${counts.g.variants} variants, ${counts.g.packings} packings`);
  const checks = await pool().query(
    `SELECT (SELECT COUNT(*) FROM shops) AS shops, (SELECT COUNT(*) FROM orders) AS orders,
            (SELECT COUNT(*) FROM customers) AS customers, (SELECT COUNT(*) FROM udhaar_accounts) AS udhaar`
  );
  console.log("[seed] checks:", checks.rows[0]);
  await pool().end();
}

main().catch((e) => {
  console.error("[seed] FAILED:", e);
  process.exit(1);
});
