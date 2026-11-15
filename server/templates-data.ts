// ─────────────────────────────────────────────────────────────────────────────
// RETAIL TEMPLATES — server copy of the Phase 1 template DATA
// (canteen-pos-export/lib/templates.ts; keep the two in sync). The 14 shop
// types of the Business Setup wizard: har qisam ke Heads → Sub-Heads aur
// DEMO products. Seeding itself lives in server/services/templates.ts and
// runs ONLY when no grocery data was ever saved (guard there).
// ─────────────────────────────────────────────────────────────────────────────

export interface TemplatePacking { label: string; retailPrice: number; wholesalePrice: number }
export interface TemplateProduct {
  name: string;
  sku: string;
  barcode?: string;
  emoji: string;
  retailPrice: number; // Rs — packings hon to kisi EK packing ki qeemat (catalogue ka usool)
  wholesalePrice: number;
  stock: number;
  unit?: "piece" | "kg";
  head: string; // template head ka NAAM
  sub: string; // template sub-head ka NAAM
  packings?: TemplatePacking[];
  trackSerial?: boolean;
}
export interface TemplateHead { name: string; emoji: string; subs: string[] }
export interface RetailTemplate {
  key: string;
  label: string;
  emoji: string;
  defaultShopName: string; // fresh setup par dukaan ka default naam (Owner baad mein badal sakta hai)
  heads: TemplateHead[];
  demoProducts: TemplateProduct[];
  builtin?: boolean; // grocery/supermarket: catalogue app ke built-in seed se ata hai
  extraHeads?: TemplateHead[]; // supermarket: built-in grocery ke UPAR fresh hisse
  extraProducts?: TemplateProduct[];
}

const pk = (label: string, retailPrice: number, wholesalePrice: number): TemplatePacking => ({ label, retailPrice, wholesalePrice });
const sizes = (labels: string[], retail: number, wholesale: number): TemplatePacking[] => labels.map((l) => pk(l, retail, wholesale));

export const RETAIL_TEMPLATES: RetailTemplate[] = [
  {
    key: "grocery", label: "Grocery Store", emoji: "🛒", defaultShopName: "Campus Grocery Store",
    heads: [], demoProducts: [], builtin: true, // built-in 622-product catalogue hi is ka seed hai
  },
  {
    key: "supermarket", label: "Supermarket", emoji: "🏬", defaultShopName: "Super Market",
    heads: [], demoProducts: [], builtin: true,
    extraHeads: [
      { name: "Sabzi & Phal", emoji: "🥬", subs: ["Sabzi", "Phal"] },
      { name: "Gosht & Murgi", emoji: "🍗", subs: ["Gosht", "Murgi"] },
      { name: "Bakery", emoji: "🥐", subs: ["Bread & Rusk", "Cake & Biscuits"] },
    ],
    extraProducts: [
      { name: "Aloo (Potato)", sku: "SM-VEG-01", emoji: "🥔", retailPrice: 120, wholesalePrice: 95, stock: 60, unit: "kg", head: "Sabzi & Phal", sub: "Sabzi" },
      { name: "Pyaaz (Onion)", sku: "SM-VEG-02", emoji: "🧅", retailPrice: 150, wholesalePrice: 120, stock: 50, unit: "kg", head: "Sabzi & Phal", sub: "Sabzi" },
      { name: "Tamatar (Tomato)", sku: "SM-VEG-03", emoji: "🍅", retailPrice: 200, wholesalePrice: 160, stock: 30, unit: "kg", head: "Sabzi & Phal", sub: "Sabzi" },
      { name: "Kela (Banana)", sku: "SM-FRT-01", emoji: "🍌", retailPrice: 220, wholesalePrice: 180, stock: 25, unit: "kg", head: "Sabzi & Phal", sub: "Phal" },
      { name: "Seb (Apple)", sku: "SM-FRT-02", emoji: "🍎", retailPrice: 350, wholesalePrice: 300, stock: 20, unit: "kg", head: "Sabzi & Phal", sub: "Phal" },
      { name: "Chicken (Murgi)", sku: "SM-MET-01", emoji: "🍗", retailPrice: 680, wholesalePrice: 620, stock: 25, unit: "kg", head: "Gosht & Murgi", sub: "Murgi" },
      { name: "Beef (Bara Gosht)", sku: "SM-MET-02", emoji: "🥩", retailPrice: 1100, wholesalePrice: 980, stock: 15, unit: "kg", head: "Gosht & Murgi", sub: "Gosht" },
      { name: "Double Roti (Bread)", sku: "SM-BAK-01", emoji: "🍞", retailPrice: 120, wholesalePrice: 100, stock: 30, head: "Bakery", sub: "Bread & Rusk" },
      { name: "Cake Rusk (Pack)", sku: "SM-BAK-02", emoji: "🍰", retailPrice: 250, wholesalePrice: 215, stock: 20, head: "Bakery", sub: "Cake & Biscuits" },
    ],
  },
  {
    key: "general", label: "General Store", emoji: "🏪", defaultShopName: "General Store",
    heads: [
      { name: "Karyana", emoji: "🧺", subs: ["Khushk Rashan", "Masala Jaat"] },
      { name: "Ghar Ka Saman", emoji: "🏠", subs: ["Safai Ka Saman", "Rozmarra Items"] },
      { name: "Personal Care", emoji: "🧴", subs: ["Sabun & Shampoo", "Dental"] },
    ],
    demoProducts: [
      { name: "Aata (10kg Bag)", sku: "GEN-001", emoji: "🌾", retailPrice: 1450, wholesalePrice: 1350, stock: 25, head: "Karyana", sub: "Khushk Rashan" },
      { name: "Cheeni (Sugar)", sku: "GEN-002", emoji: "🍚", retailPrice: 175, wholesalePrice: 160, stock: 40, unit: "kg", head: "Karyana", sub: "Khushk Rashan" },
      { name: "Chawal Basmati", sku: "GEN-003", emoji: "🍚", retailPrice: 380, wholesalePrice: 340, stock: 35, unit: "kg", head: "Karyana", sub: "Khushk Rashan" },
      { name: "Daal Chana", sku: "GEN-004", emoji: "🫘", retailPrice: 320, wholesalePrice: 290, stock: 30, unit: "kg", head: "Karyana", sub: "Khushk Rashan" },
      { name: "Chai Patti (500g)", sku: "GEN-005", emoji: "☕", retailPrice: 620, wholesalePrice: 560, stock: 30, head: "Karyana", sub: "Masala Jaat" },
      { name: "Cooking Oil (1 Litre)", sku: "GEN-006", emoji: "🫗", retailPrice: 580, wholesalePrice: 540, stock: 28, head: "Karyana", sub: "Khushk Rashan" },
      { name: "Namak (800g)", sku: "GEN-007", emoji: "🧂", retailPrice: 60, wholesalePrice: 50, stock: 50, head: "Karyana", sub: "Masala Jaat" },
      { name: "Doodh — Milk Pack (1 Litre)", sku: "GEN-008", emoji: "🥛", retailPrice: 290, wholesalePrice: 270, stock: 36, head: "Karyana", sub: "Khushk Rashan" },
      { name: "Anday — Eggs (Darjan)", sku: "GEN-009", emoji: "🥚", retailPrice: 420, wholesalePrice: 390, stock: 20, head: "Karyana", sub: "Khushk Rashan" },
      { name: "Surf Excel (1kg)", sku: "GEN-010", emoji: "🧺", retailPrice: 615, wholesalePrice: 560, stock: 22, head: "Ghar Ka Saman", sub: "Safai Ka Saman" },
      { name: "Tissue Roll", sku: "GEN-011", emoji: "🧻", retailPrice: 120, wholesalePrice: 105, stock: 48, head: "Ghar Ka Saman", sub: "Rozmarra Items" },
      { name: "Biscuit — Rio (Pack)", sku: "GEN-012", emoji: "🍪", retailPrice: 80, wholesalePrice: 70, stock: 60, head: "Ghar Ka Saman", sub: "Rozmarra Items" },
      { name: "Sabun — Lifebuoy (100g)", sku: "GEN-013", emoji: "🧼", retailPrice: 95, wholesalePrice: 85, stock: 55, head: "Personal Care", sub: "Sabun & Shampoo" },
      { name: "Shampoo — Sunsilk (180ml)", sku: "GEN-014", emoji: "🧴", retailPrice: 380, wholesalePrice: 340, stock: 26, head: "Personal Care", sub: "Sabun & Shampoo" },
      { name: "Toothpaste — Colgate (120g)", sku: "GEN-015", emoji: "🪥", retailPrice: 280, wholesalePrice: 250, stock: 30, head: "Personal Care", sub: "Dental" },
    ],
  },
  {
    key: "shoes", label: "Shoes Shop", emoji: "👞", defaultShopName: "Shoes Shop",
    heads: [
      { name: "Mardana Shoes", emoji: "👞", subs: ["Sneakers", "Formal Shoes", "Chappal & Sandal"] },
      { name: "Khawateen Shoes", emoji: "👠", subs: ["Heels", "Khussa & Sandal"] },
      { name: "Bachon Ke Shoes", emoji: "🧒", subs: ["School Shoes", "Joggers"] },
      { name: "Sports", emoji: "🏃", subs: ["Running", "Cricket"] },
    ],
    demoProducts: [
      { name: "Running Joggers — Men", sku: "SH-001", emoji: "👟", retailPrice: 3500, wholesalePrice: 3100, stock: 24, head: "Mardana Shoes", sub: "Sneakers", packings: sizes(["Size 40", "Size 41", "Size 42", "Size 43", "Size 44"], 3500, 3100) },
      { name: "Classic Sneakers — White", sku: "SH-002", emoji: "👟", retailPrice: 2800, wholesalePrice: 2500, stock: 18, head: "Mardana Shoes", sub: "Sneakers", packings: sizes(["Size 39", "Size 40", "Size 41", "Size 42", "Size 43", "Size 44"], 2800, 2500) },
      { name: "Leather Formal Shoes — Black", sku: "SH-003", emoji: "👞", retailPrice: 4500, wholesalePrice: 4000, stock: 12, head: "Mardana Shoes", sub: "Formal Shoes", packings: sizes(["Size 40", "Size 41", "Size 42", "Size 43", "Size 44"], 4500, 4000) },
      { name: "Peshawari Chappal", sku: "SH-004", emoji: "🩴", retailPrice: 2200, wholesalePrice: 1900, stock: 15, head: "Mardana Shoes", sub: "Chappal & Sandal", packings: sizes(["Size 40", "Size 41", "Size 42", "Size 43", "Size 44"], 2200, 1900) },
      { name: "Ladies Heels — Maroon", sku: "SH-005", emoji: "👠", retailPrice: 3200, wholesalePrice: 2800, stock: 10, head: "Khawateen Shoes", sub: "Heels", packings: sizes(["Size 36", "Size 37", "Size 38", "Size 39", "Size 40"], 3200, 2800) },
      { name: "Khussa — Golden", sku: "SH-006", emoji: "🥿", retailPrice: 1800, wholesalePrice: 1550, stock: 12, head: "Khawateen Shoes", sub: "Khussa & Sandal", packings: sizes(["Size 36", "Size 37", "Size 38", "Size 39", "Size 40"], 1800, 1550) },
      { name: "School Shoes — Black (Kids)", sku: "SH-007", emoji: "👞", retailPrice: 1600, wholesalePrice: 1400, stock: 20, head: "Bachon Ke Shoes", sub: "School Shoes", packings: sizes(["Size 30", "Size 31", "Size 32", "Size 33", "Size 34", "Size 35"], 1600, 1400) },
      { name: "Kids Joggers", sku: "SH-008", emoji: "👟", retailPrice: 1400, wholesalePrice: 1200, stock: 16, head: "Bachon Ke Shoes", sub: "Joggers", packings: sizes(["Size 28", "Size 29", "Size 30", "Size 31", "Size 32", "Size 33"], 1400, 1200) },
      { name: "Cricket Shoes — Spikes", sku: "SH-009", emoji: "🏏", retailPrice: 5200, wholesalePrice: 4600, stock: 8, head: "Sports", sub: "Cricket", packings: sizes(["Size 41", "Size 42", "Size 43", "Size 44", "Size 45"], 5200, 4600) },
      { name: "Sports Sandal", sku: "SH-010", emoji: "🩴", retailPrice: 1500, wholesalePrice: 1300, stock: 14, head: "Sports", sub: "Running", packings: sizes(["Size 40", "Size 41", "Size 42", "Size 43", "Size 44"], 1500, 1300) },
    ],
  },
  {
    key: "clothing", label: "Kapron ki Dukaan", emoji: "👕", defaultShopName: "Clothing Shop",
    heads: [
      { name: "Mardana", emoji: "👔", subs: ["Shalwar Kameez", "Shirt & T-Shirt", "Pant & Jeans"] },
      { name: "Khawateen", emoji: "🧕", subs: ["Suit", "Kurti"] },
      { name: "Bache", emoji: "🧒", subs: ["Bachon Ke Kapre"] },
    ],
    demoProducts: [
      { name: "Shalwar Kameez — Cotton (Gents)", sku: "CL-001", emoji: "👔", retailPrice: 3200, wholesalePrice: 2800, stock: 20, head: "Mardana", sub: "Shalwar Kameez", packings: sizes(["S", "M", "L", "XL"], 3200, 2800) },
      { name: "Kurta — White", sku: "CL-002", emoji: "👕", retailPrice: 2200, wholesalePrice: 1900, stock: 18, head: "Mardana", sub: "Shalwar Kameez", packings: sizes(["S", "M", "L", "XL"], 2200, 1900) },
      { name: "Casual T-Shirt", sku: "CL-003", emoji: "👕", retailPrice: 1200, wholesalePrice: 1000, stock: 30, head: "Mardana", sub: "Shirt & T-Shirt", packings: sizes(["S", "M", "L", "XL"], 1200, 1000) },
      { name: "Denim Jeans", sku: "CL-004", emoji: "👖", retailPrice: 2500, wholesalePrice: 2150, stock: 16, head: "Mardana", sub: "Pant & Jeans", packings: sizes(["Waist 30", "Waist 32", "Waist 34", "Waist 36"], 2500, 2150) },
      { name: "Ladies 3-Piece Suit", sku: "CL-005", emoji: "🧕", retailPrice: 4500, wholesalePrice: 3900, stock: 12, head: "Khawateen", sub: "Suit", packings: sizes(["S", "M", "L"], 4500, 3900) },
      { name: "Kurti — Printed", sku: "CL-006", emoji: "👗", retailPrice: 1800, wholesalePrice: 1550, stock: 15, head: "Khawateen", sub: "Kurti", packings: sizes(["S", "M", "L", "XL"], 1800, 1550) },
      { name: "Dupatta — Chiffon", sku: "CL-007", emoji: "🧣", retailPrice: 700, wholesalePrice: 600, stock: 25, head: "Khawateen", sub: "Suit" },
      { name: "Bachon Ka Suit (2 Piece)", sku: "CL-008", emoji: "🧒", retailPrice: 1500, wholesalePrice: 1300, stock: 14, head: "Bache", sub: "Bachon Ke Kapre", packings: sizes(["3–4 saal", "5–6 saal", "7–8 saal"], 1500, 1300) },
      { name: "Winter Shawl", sku: "CL-009", emoji: "🧣", retailPrice: 1600, wholesalePrice: 1350, stock: 10, head: "Khawateen", sub: "Suit" },
      { name: "Track Suit", sku: "CL-010", emoji: "🏃", retailPrice: 2800, wholesalePrice: 2400, stock: 12, head: "Mardana", sub: "Shirt & T-Shirt", packings: sizes(["S", "M", "L", "XL"], 2800, 2400) },
    ],
  },
  {
    key: "medical", label: "Medical Store", emoji: "💊", defaultShopName: "Medical Store",
    heads: [
      { name: "Dawaiyan", emoji: "💊", subs: ["Tablets", "Syrups", "Capsules"] },
      { name: "First Aid", emoji: "🩹", subs: ["Bandage & Dressing", "Antiseptic"] },
      { name: "Maa Bachha Care", emoji: "🍼", subs: ["Baby Care", "Vitamins"] },
    ],
    demoProducts: [
      { name: "Panadol Extra", sku: "MED-001", barcode: "8961000001011", emoji: "💊", retailPrice: 60, wholesalePrice: 50, stock: 200, head: "Dawaiyan", sub: "Tablets", packings: [pk("Strip (10 Tablets)", 60, 50), pk("Pack (100 Tablets)", 520, 460)] },
      { name: "Brufen 400mg", sku: "MED-002", emoji: "💊", retailPrice: 90, wholesalePrice: 78, stock: 150, head: "Dawaiyan", sub: "Tablets", packings: [pk("Strip (10 Tablets)", 90, 78)] },
      { name: "Arinac Forte", sku: "MED-003", emoji: "💊", retailPrice: 110, wholesalePrice: 95, stock: 120, head: "Dawaiyan", sub: "Tablets", packings: [pk("Strip (10 Tablets)", 110, 95)] },
      { name: "Hydryllin Syrup (120ml)", sku: "MED-004", emoji: "🧴", retailPrice: 180, wholesalePrice: 155, stock: 60, head: "Dawaiyan", sub: "Syrups" },
      { name: "Khansi Syrup — Herbal (120ml)", sku: "MED-005", emoji: "🧴", retailPrice: 220, wholesalePrice: 190, stock: 45, head: "Dawaiyan", sub: "Syrups" },
      { name: "Amoxicillin Capsules 250mg", sku: "MED-006", emoji: "💊", retailPrice: 240, wholesalePrice: 210, stock: 80, head: "Dawaiyan", sub: "Capsules", packings: [pk("Strip (10 Capsules)", 240, 210)] },
      { name: "ORS Sachets (Pack of 6)", sku: "MED-007", emoji: "🧂", retailPrice: 150, wholesalePrice: 130, stock: 90, head: "Dawaiyan", sub: "Tablets" },
      { name: "Bandage Roll", sku: "MED-008", emoji: "🩹", retailPrice: 80, wholesalePrice: 65, stock: 70, head: "First Aid", sub: "Bandage & Dressing" },
      { name: "Dettol Antiseptic (250ml)", sku: "MED-009", emoji: "🧴", retailPrice: 420, wholesalePrice: 370, stock: 40, head: "First Aid", sub: "Antiseptic" },
      { name: "Baby Lotion (200ml)", sku: "MED-010", emoji: "🍼", retailPrice: 550, wholesalePrice: 480, stock: 30, head: "Maa Bachha Care", sub: "Baby Care" },
      { name: "Vitamin C Tablets (20)", sku: "MED-011", emoji: "🍊", retailPrice: 450, wholesalePrice: 390, stock: 50, head: "Maa Bachha Care", sub: "Vitamins" },
      { name: "Thermometer — Digital", sku: "MED-012", emoji: "🌡️", retailPrice: 650, wholesalePrice: 560, stock: 25, head: "First Aid", sub: "Bandage & Dressing" },
    ],
  },
  {
    key: "mobile", label: "Mobile & Accessories", emoji: "📱", defaultShopName: "Mobile Shop",
    heads: [
      { name: "Mobile Phones", emoji: "📱", subs: ["Smartphones"] },
      { name: "Accessories", emoji: "🎧", subs: ["Charger & Cable", "Cover & Protector", "Audio"] },
    ],
    demoProducts: [
      { name: "Samsung Galaxy A16 (8GB · 256GB)", sku: "MOB-001", emoji: "📱", retailPrice: 54999, wholesalePrice: 51999, stock: 6, head: "Mobile Phones", sub: "Smartphones", trackSerial: true },
      { name: "Infinix Hot 50 (8GB · 128GB)", sku: "MOB-002", emoji: "📱", retailPrice: 37999, wholesalePrice: 35499, stock: 8, head: "Mobile Phones", sub: "Smartphones", trackSerial: true },
      { name: "Redmi 13 (8GB · 128GB)", sku: "MOB-003", emoji: "📱", retailPrice: 39999, wholesalePrice: 36999, stock: 7, head: "Mobile Phones", sub: "Smartphones", trackSerial: true },
      { name: "Fast Charger 25W", sku: "MOB-004", emoji: "🔌", retailPrice: 1850, wholesalePrice: 1500, stock: 40, head: "Accessories", sub: "Charger & Cable" },
      { name: "Type-C Cable (Braided)", sku: "MOB-005", emoji: "🔌", retailPrice: 650, wholesalePrice: 480, stock: 60, head: "Accessories", sub: "Charger & Cable" },
      { name: "Power Bank 10000mAh", sku: "MOB-006", emoji: "🔋", retailPrice: 3450, wholesalePrice: 2850, stock: 20, head: "Accessories", sub: "Charger & Cable" },
      { name: "Mobile Cover (Universal)", sku: "MOB-007", emoji: "📱", retailPrice: 450, wholesalePrice: 320, stock: 80, head: "Accessories", sub: "Cover & Protector" },
      { name: "Tempered Glass Protector", sku: "MOB-008", emoji: "🛡️", retailPrice: 350, wholesalePrice: 220, stock: 100, head: "Accessories", sub: "Cover & Protector" },
      { name: "Wireless Earbuds", sku: "MOB-009", emoji: "🎧", retailPrice: 2950, wholesalePrice: 2400, stock: 25, head: "Accessories", sub: "Audio" },
      { name: "Mobile Stand / Holder", sku: "MOB-010", emoji: "📱", retailPrice: 550, wholesalePrice: 400, stock: 35, head: "Accessories", sub: "Cover & Protector" },
    ],
  },
  {
    key: "electronics", label: "Electronics", emoji: "🔌", defaultShopName: "Electronics Shop",
    heads: [
      { name: "Ghar Ke Aalaat", emoji: "🔌", subs: ["Pankhe", "Kitchen Aalaat"] },
      { name: "Chhoti Electronics", emoji: "💡", subs: ["Lighting", "Iron & Garam Aalaat"] },
    ],
    demoProducts: [
      { name: "Ceiling Fan 56 Inch", sku: "ELE-001", emoji: "🌀", retailPrice: 9500, wholesalePrice: 8600, stock: 10, head: "Ghar Ke Aalaat", sub: "Pankhe" },
      { name: "Pedestal Fan", sku: "ELE-002", emoji: "🌀", retailPrice: 7200, wholesalePrice: 6500, stock: 8, head: "Ghar Ke Aalaat", sub: "Pankhe" },
      { name: "Electric Kettle 1.8L", sku: "ELE-003", emoji: "🫖", retailPrice: 3200, wholesalePrice: 2750, stock: 15, head: "Ghar Ke Aalaat", sub: "Kitchen Aalaat" },
      { name: "Sandwich Maker", sku: "ELE-004", emoji: "🥪", retailPrice: 3800, wholesalePrice: 3300, stock: 12, head: "Ghar Ke Aalaat", sub: "Kitchen Aalaat" },
      { name: "Blender & Grinder", sku: "ELE-005", emoji: "🥤", retailPrice: 6500, wholesalePrice: 5700, stock: 9, head: "Ghar Ke Aalaat", sub: "Kitchen Aalaat" },
      { name: "LED Bulb 12W", sku: "ELE-006", emoji: "💡", retailPrice: 450, wholesalePrice: 360, stock: 100, head: "Chhoti Electronics", sub: "Lighting" },
      { name: "LED Tube Light 4ft", sku: "ELE-007", emoji: "💡", retailPrice: 850, wholesalePrice: 700, stock: 50, head: "Chhoti Electronics", sub: "Lighting" },
      { name: "Steam Iron", sku: "ELE-008", emoji: "👔", retailPrice: 3600, wholesalePrice: 3100, stock: 14, head: "Chhoti Electronics", sub: "Iron & Garam Aalaat" },
      { name: "Room Heater (Halogen)", sku: "ELE-009", emoji: "🔥", retailPrice: 4800, wholesalePrice: 4200, stock: 10, head: "Chhoti Electronics", sub: "Iron & Garam Aalaat" },
      { name: "Extension Board (5 Sockets)", sku: "ELE-010", emoji: "🔌", retailPrice: 950, wholesalePrice: 780, stock: 30, head: "Chhoti Electronics", sub: "Lighting" },
    ],
  },
  {
    key: "cosmetics", label: "Cosmetics & Beauty", emoji: "💄", defaultShopName: "Cosmetics Shop",
    heads: [
      { name: "Skin Care", emoji: "🧴", subs: ["Cream & Lotion", "Face Wash"] },
      { name: "Makeup", emoji: "💄", subs: ["Lipstick & Foundation", "Aankhein"] },
      { name: "Hair Care", emoji: "💇", subs: ["Shampoo", "Hair Oil"] },
    ],
    demoProducts: [
      { name: "Moisturizing Cream (100ml)", sku: "COS-001", emoji: "🧴", retailPrice: 650, wholesalePrice: 560, stock: 40, head: "Skin Care", sub: "Cream & Lotion" },
      { name: "Sunblock SPF 60", sku: "COS-002", emoji: "🧴", retailPrice: 950, wholesalePrice: 820, stock: 30, head: "Skin Care", sub: "Cream & Lotion" },
      { name: "Face Wash (100ml)", sku: "COS-003", emoji: "🧼", retailPrice: 480, wholesalePrice: 410, stock: 45, head: "Skin Care", sub: "Face Wash" },
      { name: "Lipstick — Matte", sku: "COS-004", emoji: "💄", retailPrice: 550, wholesalePrice: 460, stock: 36, head: "Makeup", sub: "Lipstick & Foundation", packings: sizes(["Shade: Red", "Shade: Pink", "Shade: Nude"], 550, 460) },
      { name: "Foundation — Liquid", sku: "COS-005", emoji: "💄", retailPrice: 890, wholesalePrice: 760, stock: 25, head: "Makeup", sub: "Lipstick & Foundation" },
      { name: "Kajal Pencil", sku: "COS-006", emoji: "✏️", retailPrice: 250, wholesalePrice: 200, stock: 60, head: "Makeup", sub: "Aankhein" },
      { name: "Shampoo (340ml)", sku: "COS-007", emoji: "🧴", retailPrice: 620, wholesalePrice: 540, stock: 35, head: "Hair Care", sub: "Shampoo" },
      { name: "Hair Oil (200ml)", sku: "COS-008", emoji: "💇", retailPrice: 380, wholesalePrice: 320, stock: 40, head: "Hair Care", sub: "Hair Oil" },
      { name: "Mehndi Cone", sku: "COS-009", emoji: "🌿", retailPrice: 120, wholesalePrice: 95, stock: 80, head: "Makeup", sub: "Aankhein" },
      { name: "Nail Polish", sku: "COS-010", emoji: "💅", retailPrice: 300, wholesalePrice: 250, stock: 50, head: "Makeup", sub: "Lipstick & Foundation", packings: sizes(["Shade: Red", "Shade: Maroon", "Shade: Pink"], 300, 250) },
    ],
  },
  {
    key: "stationery", label: "Stationery & Books", emoji: "📚", defaultShopName: "Stationery Shop",
    heads: [
      { name: "Copies & Registers", emoji: "📓", subs: ["Copies", "Registers"] },
      { name: "Likhnay Ka Saman", emoji: "✏️", subs: ["Pen & Pencil", "Markers"] },
      { name: "School Items", emoji: "🎒", subs: ["Bag & Geometry", "Files & Folders"] },
    ],
    demoProducts: [
      { name: "Copy (200 Pages)", sku: "STA-001", emoji: "📓", retailPrice: 220, wholesalePrice: 185, stock: 120, head: "Copies & Registers", sub: "Copies" },
      { name: "Register (300 Pages)", sku: "STA-002", emoji: "📔", retailPrice: 380, wholesalePrice: 320, stock: 80, head: "Copies & Registers", sub: "Registers" },
      { name: "Ball Pen (Pack of 10)", sku: "STA-003", emoji: "🖊️", retailPrice: 200, wholesalePrice: 160, stock: 90, head: "Likhnay Ka Saman", sub: "Pen & Pencil" },
      { name: "Pencil (Pack of 12)", sku: "STA-004", emoji: "✏️", retailPrice: 180, wholesalePrice: 145, stock: 85, head: "Likhnay Ka Saman", sub: "Pen & Pencil" },
      { name: "Marker Set (12 Colors)", sku: "STA-005", emoji: "🖍️", retailPrice: 450, wholesalePrice: 380, stock: 40, head: "Likhnay Ka Saman", sub: "Markers" },
      { name: "Geometry Box", sku: "STA-006", emoji: "📐", retailPrice: 350, wholesalePrice: 290, stock: 50, head: "School Items", sub: "Bag & Geometry" },
      { name: "School Bag", sku: "STA-007", emoji: "🎒", retailPrice: 1850, wholesalePrice: 1550, stock: 20, head: "School Items", sub: "Bag & Geometry" },
      { name: "File Folder (Pack of 5)", sku: "STA-008", emoji: "📁", retailPrice: 300, wholesalePrice: 250, stock: 45, head: "School Items", sub: "Files & Folders" },
      { name: "Glue Stick", sku: "STA-009", emoji: "🧴", retailPrice: 120, wholesalePrice: 95, stock: 70, head: "School Items", sub: "Files & Folders" },
      { name: "Scientific Calculator", sku: "STA-010", emoji: "🧮", retailPrice: 1450, wholesalePrice: 1250, stock: 15, head: "School Items", sub: "Bag & Geometry" },
    ],
  },
  {
    key: "hardware", label: "Hardware & Sanitary", emoji: "🔧", defaultShopName: "Hardware Store",
    heads: [
      { name: "Paint & Rang", emoji: "🎨", subs: ["Paint", "Brush & Roller"] },
      { name: "Tools", emoji: "🔧", subs: ["Hand Tools", "Power Tools"] },
      { name: "Sanitary & Fittings", emoji: "🚿", subs: ["Taps & Pipes", "Bath Fittings"] },
    ],
    demoProducts: [
      { name: "Wall Paint", sku: "HRD-001", emoji: "🎨", retailPrice: 1050, wholesalePrice: 920, stock: 25, head: "Paint & Rang", sub: "Paint", packings: [pk("1 Litre", 1050, 920), pk("4 Litre", 3800, 3350)] },
      { name: "Paint Brush Set", sku: "HRD-002", emoji: "🖌️", retailPrice: 650, wholesalePrice: 540, stock: 30, head: "Paint & Rang", sub: "Brush & Roller" },
      { name: "Hammer", sku: "HRD-003", emoji: "🔨", retailPrice: 550, wholesalePrice: 460, stock: 22, head: "Tools", sub: "Hand Tools" },
      { name: "Screwdriver Set (6 Pieces)", sku: "HRD-004", emoji: "🪛", retailPrice: 750, wholesalePrice: 630, stock: 26, head: "Tools", sub: "Hand Tools" },
      { name: "Drill Machine", sku: "HRD-005", emoji: "🔧", retailPrice: 6500, wholesalePrice: 5700, stock: 7, head: "Tools", sub: "Power Tools" },
      { name: "Measuring Tape 5m", sku: "HRD-006", emoji: "📏", retailPrice: 420, wholesalePrice: 350, stock: 35, head: "Tools", sub: "Hand Tools" },
      { name: "Water Tap (Brass)", sku: "HRD-007", emoji: "🚰", retailPrice: 1250, wholesalePrice: 1080, stock: 18, head: "Sanitary & Fittings", sub: "Taps & Pipes" },
      { name: "PVC Pipe (3 Meter)", sku: "HRD-008", emoji: "🚿", retailPrice: 680, wholesalePrice: 580, stock: 40, head: "Sanitary & Fittings", sub: "Taps & Pipes" },
      { name: "Shower Set", sku: "HRD-009", emoji: "🚿", retailPrice: 2400, wholesalePrice: 2050, stock: 12, head: "Sanitary & Fittings", sub: "Bath Fittings" },
      { name: "Nails — Keelain (500g Box)", sku: "HRD-010", emoji: "📌", retailPrice: 350, wholesalePrice: 290, stock: 45, head: "Tools", sub: "Hand Tools" },
    ],
  },
  {
    key: "autoparts", label: "Auto Spare Parts", emoji: "🚗", defaultShopName: "Auto Parts Shop",
    heads: [
      { name: "Engine Parts", emoji: "⚙️", subs: ["Filters", "Plugs & Belts"] },
      { name: "Tyres & Wheels", emoji: "🛞", subs: ["Tyres", "Rims"] },
      { name: "Accessories", emoji: "🚗", subs: ["Care Items", "Lights"] },
    ],
    demoProducts: [
      { name: "Engine Oil Filter", sku: "AUT-001", emoji: "⚙️", retailPrice: 650, wholesalePrice: 540, stock: 40, head: "Engine Parts", sub: "Filters" },
      { name: "Air Filter", sku: "AUT-002", emoji: "⚙️", retailPrice: 850, wholesalePrice: 720, stock: 35, head: "Engine Parts", sub: "Filters" },
      { name: "Spark Plug (Set of 4)", sku: "AUT-003", emoji: "🔌", retailPrice: 1200, wholesalePrice: 1020, stock: 30, head: "Engine Parts", sub: "Plugs & Belts" },
      { name: "Timing Belt", sku: "AUT-004", emoji: "⚙️", retailPrice: 2400, wholesalePrice: 2050, stock: 15, head: "Engine Parts", sub: "Plugs & Belts" },
      { name: "Car Tyre 185/65 R15", sku: "AUT-005", emoji: "🛞", retailPrice: 14500, wholesalePrice: 13200, stock: 12, head: "Tyres & Wheels", sub: "Tyres" },
      { name: "Bike Tyre 70/90-17", sku: "AUT-006", emoji: "🛞", retailPrice: 3800, wholesalePrice: 3350, stock: 16, head: "Tyres & Wheels", sub: "Tyres" },
      { name: "Car Shampoo (500ml)", sku: "AUT-007", emoji: "🧴", retailPrice: 550, wholesalePrice: 460, stock: 45, head: "Accessories", sub: "Care Items" },
      { name: "Dashboard Polish", sku: "AUT-008", emoji: "✨", retailPrice: 480, wholesalePrice: 400, stock: 38, head: "Accessories", sub: "Care Items" },
      { name: "LED Headlight Bulb (Pair)", sku: "AUT-009", emoji: "💡", retailPrice: 2200, wholesalePrice: 1850, stock: 20, head: "Accessories", sub: "Lights" },
    ],
  },
  {
    key: "bakery", label: "Bakery & Mithaas", emoji: "🍬", defaultShopName: "Bakery & Sweets",
    heads: [
      { name: "Mithaas", emoji: "🍬", subs: ["Tol Wali Mithaas", "Packed Mithaas"] },
      { name: "Bakery Items", emoji: "🥐", subs: ["Bread & Rusk", "Cake"] },
      { name: "Namkeen", emoji: "🥨", subs: ["Nimko & Chips"] },
    ],
    demoProducts: [
      { name: "Gulab Jamun", sku: "BKR-001", emoji: "🍮", retailPrice: 1400, wholesalePrice: 1150, stock: 10, unit: "kg", head: "Mithaas", sub: "Tol Wali Mithaas" },
      { name: "Barfi (Saada)", sku: "BKR-002", emoji: "🍬", retailPrice: 1600, wholesalePrice: 1350, stock: 8, unit: "kg", head: "Mithaas", sub: "Tol Wali Mithaas" },
      { name: "Jalebi", sku: "BKR-003", emoji: "🥨", retailPrice: 1200, wholesalePrice: 1000, stock: 6, unit: "kg", head: "Mithaas", sub: "Tol Wali Mithaas" },
      { name: "Laddu (Motichoor)", sku: "BKR-004", emoji: "🍬", retailPrice: 1300, wholesalePrice: 1080, stock: 7, unit: "kg", head: "Mithaas", sub: "Tol Wali Mithaas" },
      { name: "Mithaas Mix (Packed 500g)", sku: "BKR-005", emoji: "🎁", retailPrice: 750, wholesalePrice: 640, stock: 20, head: "Mithaas", sub: "Packed Mithaas" },
      { name: "Double Roti (Bread)", sku: "BKR-006", emoji: "🍞", retailPrice: 120, wholesalePrice: 100, stock: 35, head: "Bakery Items", sub: "Bread & Rusk" },
      { name: "Cake Rusk (Pack)", sku: "BKR-007", emoji: "🍰", retailPrice: 250, wholesalePrice: 215, stock: 28, head: "Bakery Items", sub: "Bread & Rusk" },
      { name: "Fruit Cake (1 Pound)", sku: "BKR-008", emoji: "🎂", retailPrice: 850, wholesalePrice: 720, stock: 10, head: "Bakery Items", sub: "Cake" },
      { name: "Nimko (Pack 250g)", sku: "BKR-009", emoji: "🥨", retailPrice: 180, wholesalePrice: 150, stock: 40, head: "Namkeen", sub: "Nimko & Chips" },
      { name: "Chips (Homemade Pack)", sku: "BKR-010", emoji: "🍟", retailPrice: 150, wholesalePrice: 125, stock: 45, head: "Namkeen", sub: "Nimko & Chips" },
    ],
  },
  {
    key: "toys", label: "Toys & Gifts", emoji: "🧸", defaultShopName: "Toys & Gift Shop",
    heads: [
      { name: "Toys", emoji: "🧸", subs: ["Soft Toys", "Gariyan & Action"] },
      { name: "Games", emoji: "🎲", subs: ["Board Games", "Outdoor"] },
      { name: "Gift Items", emoji: "🎁", subs: ["Gift Packs"] },
    ],
    demoProducts: [
      { name: "Teddy Bear (Medium)", sku: "TOY-001", emoji: "🧸", retailPrice: 1250, wholesalePrice: 1050, stock: 15, head: "Toys", sub: "Soft Toys" },
      { name: "Remote Control Car", sku: "TOY-002", emoji: "🚗", retailPrice: 2450, wholesalePrice: 2050, stock: 10, head: "Toys", sub: "Gariyan & Action" },
      { name: "Action Figure", sku: "TOY-003", emoji: "🦸", retailPrice: 850, wholesalePrice: 700, stock: 22, head: "Toys", sub: "Gariyan & Action" },
      { name: "Ludo + Snakes Board Game", sku: "TOY-004", emoji: "🎲", retailPrice: 650, wholesalePrice: 540, stock: 25, head: "Games", sub: "Board Games" },
      { name: "Puzzle (500 Pieces)", sku: "TOY-005", emoji: "🧩", retailPrice: 780, wholesalePrice: 650, stock: 18, head: "Games", sub: "Board Games" },
      { name: "Cricket Bat (Kids)", sku: "TOY-006", emoji: "🏏", retailPrice: 1150, wholesalePrice: 950, stock: 14, head: "Games", sub: "Outdoor" },
      { name: "Football (Size 5)", sku: "TOY-007", emoji: "⚽", retailPrice: 1350, wholesalePrice: 1120, stock: 16, head: "Games", sub: "Outdoor" },
      { name: "Gift Pack (Small)", sku: "TOY-008", emoji: "🎁", retailPrice: 950, wholesalePrice: 800, stock: 20, head: "Gift Items", sub: "Gift Packs" },
      { name: "Water Gun (Pichkari)", sku: "TOY-009", emoji: "🔫", retailPrice: 450, wholesalePrice: 370, stock: 30, head: "Toys", sub: "Gariyan & Action" },
    ],
  },
];

export function templateOf(key: string | null | undefined): RetailTemplate | undefined {
  if (!key) return undefined;
  return RETAIL_TEMPLATES.find((t) => t.key === key);
}
