// ─────────────────────────────────────────────────────────────────────────────
// RETAIL TEMPLATES — METADATA (Phase 2 client copy).
// Business Setup wizard ke 14 retail types ke naam/emoji/default shop
// naam. Poora template DATA (heads, demo products) server par hai
// (server/templates-data.ts) aur seeding bhi server karta hai — settings
// save par, sirf jab grocery data kabhi save na hua ho. Client ko sirf
// labels chahiye (wizard cards, POS tab naam, owner sections).
// ─────────────────────────────────────────────────────────────────────────────

export interface RetailTemplateMeta {
  key: string;
  label: string;
  emoji: string;
  defaultShopName: string; // fresh setup par dukaan ka default naam
}

export const RETAIL_TEMPLATES: RetailTemplateMeta[] = [
  { key: "grocery", label: "Grocery Store", emoji: "🛒", defaultShopName: "Campus Grocery Store" },
  { key: "supermarket", label: "Supermarket", emoji: "🏬", defaultShopName: "Super Market" },
  { key: "general", label: "General Store", emoji: "🏪", defaultShopName: "General Store" },
  { key: "shoes", label: "Shoes Shop", emoji: "👞", defaultShopName: "Shoes Shop" },
  { key: "clothing", label: "Kapron ki Dukaan", emoji: "👕", defaultShopName: "Clothing Shop" },
  { key: "medical", label: "Medical Store", emoji: "💊", defaultShopName: "Medical Store" },
  { key: "mobile", label: "Mobile & Accessories", emoji: "📱", defaultShopName: "Mobile Shop" },
  { key: "electronics", label: "Electronics", emoji: "🔌", defaultShopName: "Electronics Shop" },
  { key: "cosmetics", label: "Cosmetics & Beauty", emoji: "💄", defaultShopName: "Cosmetics Shop" },
  { key: "stationery", label: "Stationery & Books", emoji: "📚", defaultShopName: "Stationery Shop" },
  { key: "hardware", label: "Hardware & Sanitary", emoji: "🔧", defaultShopName: "Hardware Store" },
  { key: "autoparts", label: "Auto Spare Parts", emoji: "🚗", defaultShopName: "Auto Parts Shop" },
  { key: "bakery", label: "Bakery & Mithaas", emoji: "🍬", defaultShopName: "Bakery & Sweets" },
  { key: "toys", label: "Toys & Gifts", emoji: "🧸", defaultShopName: "Toys & Gift Shop" },
];

export function templateOf(key: string | null | undefined): RetailTemplateMeta | undefined {
  if (!key) return undefined;
  return RETAIL_TEMPLATES.find((t) => t.key === key);
}
