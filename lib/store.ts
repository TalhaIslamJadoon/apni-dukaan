// ─────────────────────────────────────────────────────────────────────────────
// Data layer — Phase 1
// Phase 1 persistence: browser localStorage, so the prototype runs standalone
// with zero setup. ALL reads/writes go through the functions in this file.
// Phase 2: replace ONLY the bodies of load*/save* with PostgreSQL queries
// (via Next.js API routes / Server Actions + Prisma or Drizzle) — the page
// components consume the same MenuItem / Order types and will not change.
// Redis is planned in Phase 2 as a cache for the menu + today's totals on
// top of PostgreSQL. It is NOT used or faked in Phase 1.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// ★ SHOP CONFIG — change the names in THIS ONE PLACE only ★
// Talha runs the canteen + grocery store on contract at a college (names
// NOT yet given — these are neutral placeholders, do not invent real ones).
// The bill header, header bar and table-QR cards all read from here.
// This system is NOT connected to any college LMS/administration software.
// ─────────────────────────────────────────────────────────────────────────────
export const SHOP = {
  systemName: "POS SYSTEM",
  canteenName: "College Canteen",
  groceryName: "Campus Grocery Store",
  tagline: "College Canteen & Campus Grocery Store",
};

// ── Shop Settings (editable in Owner Dashboard → Shop Settings) ─────────────
// Talha will set the real college + shop names HIMSELF from inside the app —
// no code editing. Defaults are the neutral placeholders above; saved values
// live in localStorage and override them everywhere (header, bills, QR cards,
// online page). This is the single source of truth — components use useShop().
import { useEffect, useState } from "react";
export interface ShopSettings {
  collegeName: string;
  canteenName: string;
  groceryName: string;
  // Online-payment receiving details (Owner → Shop Settings). For ONLINE
  // orders the customer sends money to one of these BEFORE the order is
  // confirmed and uploads a screenshot as proof (see OrderPaymentProof).
  jazzcashNumber: string;
  easypaisaNumber: string;
  raastInfo: string; // Raast ID / bank IBAN — shown for Raast + Bank transfers
  // Merchant QR images (Owner → Shop Settings) — Talha uploads the REAL QR
  // picture of each account (app se mila hua QR) so customers scan-and-pay
  // on the online payment step. Stored as downscaled PNG data URLs; "" =
  // koi QR nahi lagaya (customer ko sirf number dikhta hai). Account titles
  // sirf QR Stand card par chhapte hain. Raast aur Bank ka number aik hi
  // (raastInfo) hai, lekin QR dono ke alag alag lag sakte hain.
  qrJazzCash: string;
  qrEasypaisa: string;
  qrRaast: string;
  qrBank: string;
  titleJazzCash: string;
  titleEasypaisa: string;
  titleRaast: string;
  titleBank: string;
  // Shop-wide wholesale minimums (Owner → Shop Settings). A product may
  // override either default with GroceryItem.wholesaleMinQty.
  wholesaleMinPieces: number; // minimum pieces (or packs) per wholesale bill line
  wholesaleMinKg: number; // minimum kg per loose wholesale bill line
  // Closed-shop popup (Owner → Shop Settings): when shopOpen is false the
  // /online page (remote + table-QR alike) stops taking orders and shows
  // this contact number with Call / WhatsApp buttons instead. Manual
  // toggle for now — the PC-off AUTO version comes at deployment with the
  // always-online gateway page.
  closedContactNumber: string;
  shopOpen: boolean;
  // Adjustable table count (Owner → Tables & QR): exactly this many table
  // QR cards are printed, and the /online table flow only accepts table
  // numbers 1..tableCount. Bounds 1..100. Changing it never touches past
  // orders or bills (they keep the table number they were placed with).
  tableCount: number;
}
export const SHOP_DEFAULTS: ShopSettings = {
  collegeName: "",
  canteenName: SHOP.canteenName,
  groceryName: SHOP.groceryName,
  // DEMO placeholders — Talha sets the real numbers in Shop Settings.
  jazzcashNumber: "03XX-XXXXXXX (demo)",
  easypaisaNumber: "03XX-XXXXXXX (demo)",
  raastInfo: "03XX-XXXXXXX (demo Raast ID)",
  // Koi merchant QR default nahi — farzi QR kabhi asal keh kar nahi dikhana.
  // Talha apne asal account QR Settings se upload karega.
  qrJazzCash: "",
  qrEasypaisa: "",
  qrRaast: "",
  qrBank: "",
  titleJazzCash: "",
  titleEasypaisa: "",
  titleRaast: "",
  titleBank: "",
  wholesaleMinPieces: 10,
  wholesaleMinKg: 5,
  // DEMO placeholder — Talha sets his real number in Shop Settings.
  closedContactNumber: "0300-0000000 (demo)",
  shopOpen: true,
  tableCount: 8,
};
const SHOP_KEY = "canteen-pos-shop-v1";
export function loadShop(): ShopSettings {
  try {
    const raw = localStorage.getItem(SHOP_KEY);
    if (raw) return { ...SHOP_DEFAULTS, ...(JSON.parse(raw) as Partial<ShopSettings>) };
  } catch { /* ignore */ }
  return { ...SHOP_DEFAULTS };
}
export function saveShop(s: ShopSettings) {
  try {
    localStorage.setItem(SHOP_KEY, JSON.stringify(s));
    window.dispatchEvent(new Event("shop-updated"));
  } catch { /* ignore */ }
}
export function useShop(): ShopSettings {
  const [shop, setShop] = useState<ShopSettings>(SHOP_DEFAULTS);
  useEffect(() => {
    const read = () => setShop(loadShop());
    read();
    window.addEventListener("shop-updated", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("shop-updated", read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return shop;
}

// ── Customer accounts — REMOTE online orders ONLY (Talha, 14 Nov 2026) ──────
// Walk-in and table-QR customers NEVER create an account. A customer ordering
// REMOTELY (hostel room / office / anywhere online) MUST have an account —
// fake-order protection. The account is made with the MOBILE NUMBER as the
// login ID; the student/staff ID inside the account stays OPTIONAL (needed
// only for Udhaar). PROTOTYPE HONESTY: passwords are stored locally in plain
// form for this demo only — Phase 2 moves accounts to the PostgreSQL backend
// with proper password hashing. Do not use a real personal password in the demo.
export interface CustomerAccount {
  name: string;
  mobile: string; // unique login ID
  password: string; // DEMO ONLY — hashed server-side in Phase 2
  placeType: "Hostel Room" | "Office" | "Other";
  placeDetail: string; // e.g. "Room 12", "Accounts Office"
  studentId?: string; // OPTIONAL — required only for Udhaar
  createdAt: number;
}
const ACCOUNTS_KEY = "canteen-pos-accounts-v1";
const SESSION_KEY = "canteen-pos-session-v1";
export function loadAccounts(): CustomerAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (raw) return JSON.parse(raw) as CustomerAccount[];
  } catch { /* ignore */ }
  return [];
}
export function registerAccount(a: Omit<CustomerAccount, "createdAt">): "ok" | "exists" {
  const all = loadAccounts();
  if (all.some((x) => x.mobile === a.mobile)) return "exists";
  all.push({ ...a, createdAt: Date.now() });
  try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(all)); } catch { /* ignore */ }
  setSession(a.mobile);
  return "ok";
}
export function loginAccount(mobile: string, password: string): CustomerAccount | null {
  const acc = loadAccounts().find((x) => x.mobile === mobile && x.password === password);
  if (acc) setSession(mobile);
  return acc ?? null;
}
export function setSession(mobile: string | null) {
  try {
    if (mobile) localStorage.setItem(SESSION_KEY, mobile);
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* ignore */ }
}
export function getSessionAccount(): CustomerAccount | null {
  try {
    const m = localStorage.getItem(SESSION_KEY);
    if (!m) return null;
    return loadAccounts().find((x) => x.mobile === m) ?? null;
  } catch { return null; }
}

export type Category = "Chai" | "Cold Drink" | "Fast Food" | "Nashta" | "Snacks";

// Business modes: ONE system, one billing/payment/stock/report engine,
// shared orders + owner dashboard. Modes have SEPARATE cashier screens
// (top tabs) — a mode never leaks into another mode's screen.
// Both "canteen" and "grocery" ship in this build (Talha, 14 Nov 2026).
export type BusinessMode = "canteen" | "grocery";
export const BUSINESS_MODE: BusinessMode = "canteen";

export interface MenuItem {
  id: string;
  name: string;
  price: number; // Rs
  category: Category;
  emoji: string;
  image?: string; // optional real photo (path/URL) — online 3D picture cards render it in the same frame when set; emoji is the offline-safe fallback art
  sku?: string; // optional barcode / SKU — unused by canteen tiles, ready for Grocery Mode
  mode?: BusinessMode; // defaults to BUSINESS_MODE when absent
  stock?: number; // pieces in stock — decremented on every canteen sale (counter + online); managed on the Stock screen
  lowStock?: number; // low-stock threshold in pieces (default 5) — highlighted on the Stock screen
}

export type PaymentMethod = "Cash" | "JazzCash" | "Easypaisa" | "Udhaar" | "Online" | "Counter";

// ── Online payment proof (Talha, 14 Nov 2026) ───────────────────────────────
// Rule for ONLINE orders: "payment pehle, order confirm baad mein". The
// customer pays the shop's JazzCash / Easypaisa / Raast / Bank number first
// and uploads a screenshot of the payment as PROOF. The order is created
// with paymentStatus "proof_pending" and an order token of 0 — it does NOT
// reach the Kitchen / packing queue. Staff verify the proof in the Owner
// Dashboard; only on Confirm is the token assigned and the order released
// to fulfilment. Named `paymentProof` because `payment` is already the
// Order's PaymentMethod field. PROTOTYPE: the proof image is a compressed
// data URL stored with the order in localStorage — Phase 2 moves proofs to
// server-side file storage (automatic gateway verification is a later step).
export type ProofPaymentMethod = "JazzCash" | "Easypaisa" | "Raast" | "Bank";
// Merchant receiving details per proof method — ONE mapping used by the
// online payment step AND the Owner QR Stand, so they can never drift.
// Raast aur Bank dono ka number raastInfo hi hai (aik hi box Settings mein).
export function merchantNumber(shop: ShopSettings, m: ProofPaymentMethod): string {
  return m === "JazzCash" ? shop.jazzcashNumber : m === "Easypaisa" ? shop.easypaisaNumber : shop.raastInfo;
}
export function merchantQr(shop: ShopSettings, m: ProofPaymentMethod): string {
  return m === "JazzCash" ? shop.qrJazzCash : m === "Easypaisa" ? shop.qrEasypaisa : m === "Raast" ? shop.qrRaast : shop.qrBank;
}
export function merchantTitle(shop: ShopSettings, m: ProofPaymentMethod): string {
  return m === "JazzCash" ? shop.titleJazzCash : m === "Easypaisa" ? shop.titleEasypaisa : m === "Raast" ? shop.titleRaast : shop.titleBank;
}
export const QR_FIELD_OF: Record<ProofPaymentMethod, "qrJazzCash" | "qrEasypaisa" | "qrRaast" | "qrBank"> = {
  JazzCash: "qrJazzCash", Easypaisa: "qrEasypaisa", Raast: "qrRaast", Bank: "qrBank",
};
export const TITLE_FIELD_OF: Record<ProofPaymentMethod, "titleJazzCash" | "titleEasypaisa" | "titleRaast" | "titleBank"> = {
  JazzCash: "titleJazzCash", Easypaisa: "titleEasypaisa", Raast: "titleRaast", Bank: "titleBank",
};
export interface OrderPaymentProof {
  method: ProofPaymentMethod;
  txnId?: string; // transaction ID the customer typed (optional)
  amount: number; // Rs the customer says they paid (= order total at placement)
  proofImage: string; // compressed screenshot — data URL (max 1200px, JPEG)
  uploadedAt: number; // epoch ms
}
export type OrderPaymentStatus = "proof_pending" | "confirmed" | "rejected";

export interface OrderLine {
  itemId: string;
  name: string;
  price: number;
  qty: number;
}

export interface Order {
  id: string;
  billNo?: string; // sequential unique bill number, e.g. "B-0007" (professional billing)
  mode?: BusinessMode; // "canteen" (default for old records) | "grocery"
  priceType?: "retail" | "wholesale"; // grocery orders
  token: number; // sequential, per day
  lines: OrderLine[];
  subtotal?: number; // before discount (falls back to total on old records)
  discount?: number; // Rs amount deducted
  total: number; // grand total actually charged
  cashier?: string;
  payment: PaymentMethod;
  paymentProof?: OrderPaymentProof; // online orders paid up-front (proof screenshot)
  paymentStatus?: OrderPaymentStatus; // ONLY on proof-flow online orders — undefined = normal order (counter bills, table-QR cash, udhaar): treat as confirmed
  rejectReason?: string; // staff's reason when paymentStatus === "rejected" (customer sees it)
  tendered?: number; // cash given
  change?: number; // baqaya returned
  udhaarName?: string;
  source?: "counter" | "online"; // online orders come from the Online Order tab
  orderType?: "dine-in" | "takeaway"; // online orders: chosen before checkout
  tableNo?: number; // dine-in table orders (from the table QR)
  customerName?: string; // online orders: student/staff name (optional for table orders)
  customerId?: string; // optional student/staff ID — written on udhaar orders / stored in a remote account; NOT an account by itself
  customerMobile?: string; // remote account mobile / contact number for pickup confirmation
  identityType?: "id" | "guest" | "table" | "account"; // how the customer identified
  placeLabel?: string; // remote account orders: e.g. "Hostel Room 12", "Office — Accounts"
  status: "pending" | "preparing" | "ready";
  createdAt: string; // ISO
}

// Category colours — cashier recognises the category by colour, not by reading.
export const CATEGORY_STYLE: Record<Category, { bg: string; ring: string; chip: string; label: string }> = {
  Chai:        { bg: "#EFEBE9", ring: "#795548", chip: "#795548", label: "Chai" },
  "Cold Drink":{ bg: "#E3F2FD", ring: "#1976D2", chip: "#1976D2", label: "Cold Drink" },
  "Fast Food": { bg: "#FCE4EC", ring: "#E64A19", chip: "#E64A19", label: "Fast Food" },
  Nashta:      { bg: "#E8F5E9", ring: "#388E3C", chip: "#388E3C", label: "Nashta" },
  Snacks:      { bg: "#F3E5F5", ring: "#8E24AA", chip: "#8E24AA", label: "Snacks" },
};

export const CATEGORIES: Category[] = ["Chai", "Cold Drink", "Fast Food", "Nashta", "Snacks"];

// ── SAMPLE menu ──────────────────────────────────────────────────────────────
// Talha has not yet given the real menu. These are typical Pakistani canteen
// items with realistic Rs prices, for testing the prototype only.
export const SAMPLE_MENU: MenuItem[] = [
  // Chai (brown)
  { id: "chai-1", image: "/images/canteen/chai-1.jpg", name: "Doodh Patti Chai", price: 80, category: "Chai", emoji: "☕" , stock: 60 },
  { id: "chai-2", image: "/images/canteen/chai-2.jpg", name: "Elaichi Chai", price: 100, category: "Chai", emoji: "🫖" , stock: 45 },
  { id: "chai-3", image: "/images/canteen/chai-3.jpg", name: "Green Tea / Qehwa", price: 60, category: "Chai", emoji: "🍵" , stock: 40 },
  { id: "chai-4", image: "/images/canteen/chai-4.jpg", name: "Coffee", price: 150, category: "Chai", emoji: "☕" , stock: 4 },
  // Cold Drink (blue)
  { id: "cold-1", image: "/images/canteen/cold-1.jpg", name: "Soft Drink (Can)", price: 80, category: "Cold Drink", emoji: "🥤" , stock: 96 },
  { id: "cold-2", image: "/images/canteen/cold-2.jpg", name: "Soft Drink (1.5L Bottle)", price: 180, category: "Cold Drink", emoji: "🍾" , stock: 24 },
  { id: "cold-3", image: "/images/canteen/cold-3.jpg", name: "Mineral Water (Small)", price: 60, category: "Cold Drink", emoji: "💧" , stock: 120 },
  { id: "cold-4", image: "/images/canteen/cold-4.jpg", name: "Fresh Lime / Lassi", price: 120, category: "Cold Drink", emoji: "🥛" , stock: 30 },
  { id: "cold-5", image: "/images/canteen/cold-5.jpg", name: "Juice (Pack)", price: 70, category: "Cold Drink", emoji: "🧃" , stock: 72 },
  // Fast Food (red/orange)
  { id: "fast-1", image: "/images/canteen/fast-1.jpg", name: "Chicken Burger", price: 350, category: "Fast Food", emoji: "🍔" , stock: 35 },
  { id: "fast-2", image: "/images/canteen/fast-2.jpg", name: "Zinger Burger", price: 450, category: "Fast Food", emoji: "🍔" , stock: 3 },
  { id: "fast-3", image: "/images/canteen/fast-3.jpg", name: "Chicken Shawarma", price: 250, category: "Fast Food", emoji: "🌯" , stock: 28 },
  { id: "fast-4", image: "/images/canteen/fast-4.jpg", name: "Fries (Regular)", price: 150, category: "Fast Food", emoji: "🍟" , stock: 50 },
  { id: "fast-5", image: "/images/canteen/fast-5.jpg", name: "Chicken Biryani", price: 300, category: "Fast Food", emoji: "🍛" , stock: 26 },
  { id: "fast-6", image: "/images/canteen/fast-6.jpg", name: "Daal Chawal", price: 220, category: "Fast Food", emoji: "🍚" , stock: 32 },
  // Nashta (green)
  { id: "nash-1", image: "/images/canteen/nash-1.jpg", name: "Halwa Puri Set", price: 250, category: "Nashta", emoji: "🫓" , stock: 22 },
  { id: "nash-2", image: "/images/canteen/nash-2.jpg", name: "Anda Paratha", price: 180, category: "Nashta", emoji: "🍳" , stock: 30 },
  { id: "nash-3", image: "/images/canteen/nash-3.jpg", name: "Plain Paratha", price: 80, category: "Nashta", emoji: "🫓" , stock: 45 },
  { id: "nash-4", image: "/images/canteen/nash-4.jpg", name: "Omelette + Toast", price: 200, category: "Nashta", emoji: "🥚" , stock: 18 },
  // Snacks (purple)
  { id: "snk-1", image: "/images/canteen/snk-1.jpg", name: "Samosa (1 pc)", price: 50, category: "Snacks", emoji: "🔺" , stock: 80 },
  { id: "snk-2", image: "/images/canteen/snk-2.jpg", name: "Pakora (Plate)", price: 150, category: "Snacks", emoji: "🧆" , stock: 40 },
  { id: "snk-3", image: "/images/canteen/snk-3.jpg", name: "Roll Paratha", price: 200, category: "Snacks", emoji: "🌮" , stock: 25 },
  { id: "snk-4", image: "/images/canteen/snk-4.jpg", name: "Biscuits (Pack)", price: 50, category: "Snacks", emoji: "🍪" , stock: 60 },
  { id: "snk-5", image: "/images/canteen/snk-5.jpg", name: "Chips (Pack)", price: 60, category: "Snacks", emoji: "🍿" , stock: 90 },
  { id: "snk-6", image: "/images/canteen/snk-6.jpg", name: "Chocolate", price: 100, category: "Snacks", emoji: "🍫" , stock: 55 },
];

const MENU_KEY = "canteen-pos-menu-v1";
const ORDERS_KEY = "canteen-pos-orders-v1";

function todayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function loadMenu(): MenuItem[] {
  if (typeof window === "undefined") return SAMPLE_MENU;
  try {
    const raw = window.localStorage.getItem(MENU_KEY);
    const parsed = raw ? (JSON.parse(raw) as MenuItem[]) : null;
    const list = Array.isArray(parsed) && parsed.length ? parsed : SAMPLE_MENU;
    // Normalise: older saved menus have no stock fields — give them sample stock
    // so the Stock screen and sale decrements always have numbers to work with.
    return list.map((m) => ({ ...m, stock: typeof m.stock === "number" ? m.stock : 50, lowStock: typeof m.lowStock === "number" ? m.lowStock : 5 }));
  } catch { return SAMPLE_MENU; }
}

export function saveMenu(menu: MenuItem[]): void {
  try { window.localStorage.setItem(MENU_KEY, JSON.stringify(menu)); } catch {}
}

export function loadOrders(): Order[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ORDERS_KEY);
    return raw ? (JSON.parse(raw) as Order[]) : [];
  } catch { return []; }
}

export function saveOrders(orders: Order[]): void {
  try { window.localStorage.setItem(ORDERS_KEY, JSON.stringify(orders)); } catch {}
  // notify other tabs / same-tab listeners (kitchen screen)
  try { window.dispatchEvent(new Event("canteen-orders-changed")); } catch {}
  // cross-tab near-instant signal for the staff order-alert engine
  try { const bc = new BroadcastChannel("canteen-pos-orders"); bc.postMessage("changed"); bc.close(); } catch {}
}

export function nextBillNo(orders: Order[]): string {
  let max = 0;
  for (const o of orders) {
    const m = o.billNo?.match(/(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `B-${String(Math.max(max, orders.length) + 1).padStart(4, "0")}`;
}

export function billNoOf(o: Order): string {
  return o.billNo || `B-${String(o.token).padStart(4, "0")}`;
}

export function nextToken(orders: Order[]): number {
  const t = todayKey();
  const todays = orders.filter((o) => o.createdAt.slice(0, 10) === t);
  return todays.length ? Math.max(...todays.map((o) => o.token)) + 1 : 1;
}

export function isToday(o: Order): boolean {
  return o.createdAt.slice(0, 10) === todayKey();
}

/**
 * Fulfilment gate for the payment-proof flow: an order may reach the
 * Kitchen / grocery packing queue only when its payment is cleared —
 * paymentStatus undefined (all normal orders) or "confirmed".
 * "proof_pending" and "rejected" online orders stay OUT of fulfilment.
 */
export function isPaymentCleared(o: Order): boolean {
  return o.paymentStatus === undefined || o.paymentStatus === "confirmed";
}

/**
 * Move an order's stock by its lines: dir -1 deducts, +1 restores.
 * Grocery stock is per PRODUCT (packing lines sum onto their product);
 * canteen stock is per menu item. Used when a proof-flow order is
 * REJECTED (restore — placement already deducted) and when the customer
 * re-uploads a proof after a rejection (deduct again). Placement itself
 * deducts inline in the online checkout, exactly like counter sales.
 */
export function adjustStockForOrder(order: Order, dir: 1 | -1): void {
  if (typeof window === "undefined") return;
  const per = new Map<string, number>();
  order.lines.forEach((l) => per.set(l.itemId, (per.get(l.itemId) ?? 0) + l.qty));
  if (!per.size) return;
  if (order.mode === "grocery") {
    saveGrocery(loadGrocery().map((it) => {
      const q = per.get(it.id);
      return q ? { ...it, stock: Math.max(0, Math.round((it.stock + dir * q) * 10) / 10) } : it;
    }));
  } else {
    saveMenu(loadMenu().map((m) => {
      const q = per.get(m.id);
      return q ? { ...m, stock: Math.max(0, (m.stock ?? 0) + dir * q) } : m;
    }));
  }
}

// ── GROCERY MODE — 3-LEVEL STRUCTURE: Main Head → Sub Head → Product ────────
// (Talha's approved structure, 14 Nov 2026 — replaces the old 2-level
// "sections" model.) Every product lives in exactly ONE sub-head; every
// sub-head lives in ONE main head. The catalogue — 20 heads, 39 sub-heads,
// 390 products — is Talha's own list, kept as data in lib/catalog-seed.json
// (plain-text source: categories-source.txt) and flattened into the seeds
// below. Prices / stock in the seed are SAMPLE values: the owner sets the
// real ones in Owner Dashboard → Grocery Products. Same billing / payment /
// stock / report engine as the canteen — only the product organisation
// changed. The heads and sub-heads are state like staff/products: the owner
// can add / rename them in the Owner Dashboard, and they persist in
// localStorage. The Grocery POS and the online grocery view filter their
// tiles by head chips (row 1) and sub-head chips (row 2); search always
// looks across ALL heads.

export interface PackingOption {
  label: string; // a SIZE of the product: "500g", "1kg", "2.25L"…
  retailPrice: number;
  wholesalePrice: number;
}

export interface GroceryItem {
  id: string;
  name: string;
  headId: string; // main head this product lives under (GroceryHead.id)
  subId: string; // sub-head id — namespaced `${headId}:${subSlug}`, unique across heads
  sku: string; // shop SKU / PLU code (typed or scanned) — loose per-kg items are sold by this
  barcode?: string; // EAN barcode on packed/branded products — the counter scanner reads THIS first, then SKU
  retailPrice: number; // Rs — per piece, or per kg when unit === "kg"
  wholesalePrice: number; // Rs
  wholesaleMinQty?: number; // optional per-product wholesale minimum, in this product's unit (packs for packing lines); undefined = shop default
  stock: number; // pieces, or kg when unit === "kg"
  unit: "piece" | "kg";
  lowStock?: number; // low-stock threshold (default: 5 pcs / 2 kg) — highlighted on the Stock screen
  emoji: string;
  image?: string; // optional real photo — same 3D picture-card frame as the canteen items when set
  // Size variants of THIS product (Talha's rule: a size is a PACKING of one
  // product, never a separate item). A sold packing bills as
  // `Name (Label)` at the packing's own price. Stock is tracked per
  // PRODUCT, not per packing (prototype simplification).
  packings?: PackingOption[];
}

export interface GroceryHead {
  id: string;
  name: string;
  emoji: string;
  tint: string; // soft pastel background — same pastel family as the product tiles
  image?: string; // optional picture (URL/path) — tile fallback: product → sub-head → head → emoji
}

export interface GrocerySubHead {
  id: string; // namespaced: `${headId}:${subSlug}`
  headId: string;
  name: string;
  image?: string; // optional picture (URL/path) — see the tile fallback rule on GroceryHead
}

import catalogSeed from "./catalog-seed.json";

interface CatalogProduct {
  id: string; name: string; sku: string; barcode?: string;
  retailPrice: number; wholesalePrice: number; stock: number;
  unit: "piece" | "kg"; emoji: string; packings?: PackingOption[]; image?: string;
}
interface CatalogSub { id: string; name: string; image?: string; products: CatalogProduct[]; }
interface CatalogHead { id: string; name: string; emoji: string; image?: string; subs: CatalogSub[]; }
const CATALOG_HEADS = (catalogSeed as unknown as { heads: CatalogHead[] }).heads;

// Soft pastel tints — one per seeded head, same family as the old section tints.
const HEAD_TINTS = [
  "#FFFBEB", "#FEF9C3", "#FDF2F8", "#EFF6FF", "#F0FDF4",
  "#FFF7ED", "#FEF2F2", "#FDF4FF", "#ECFEFF", "#E0F2FE",
  "#F5F3FF", "#FDF2F8", "#F0FDF4", "#E0F2FE", "#F5F3FF",
  "#FFFBEB", "#EFF6FF", "#FEF9C3", "#FEF2F2", "#F5F5F4",
];

export const GROCERY_HEADS_SEED: GroceryHead[] = CATALOG_HEADS.map((h, i) => {
  const head: GroceryHead = { id: h.id, name: h.name, emoji: h.emoji, tint: HEAD_TINTS[i % HEAD_TINTS.length] };
  if (h.image) head.image = h.image; // empty for now — picture manifest is integrated separately
  return head;
});

export const GROCERY_SUBHEADS_SEED: GrocerySubHead[] = CATALOG_HEADS.flatMap((h) =>
  h.subs.map((s) => {
    const sub: GrocerySubHead = { id: `${h.id}:${s.id}`, headId: h.id, name: s.name };
    if (s.image) sub.image = s.image;
    return sub;
  })
);

export const SAMPLE_GROCERY: GroceryItem[] = CATALOG_HEADS.flatMap((h) =>
  h.subs.flatMap((s) =>
    s.products.map((p) => {
      const item: GroceryItem = {
        id: p.id, name: p.name, headId: h.id, subId: `${h.id}:${s.id}`, sku: p.sku,
        retailPrice: p.retailPrice, wholesalePrice: p.wholesalePrice,
        stock: p.stock, unit: p.unit, emoji: p.emoji,
      };
      if (p.barcode) item.barcode = p.barcode;
      if (p.image) item.image = p.image;
      if (p.packings && p.packings.length) item.packings = p.packings.map((k) => ({ ...k }));
      return item;
    })
  )
);

/**
 * Tile picture fallback (Talha): the product's own image wins; if it has
 * none, its SUB-HEAD's image; then its HEAD's image; otherwise undefined
 * and the tile renders the emoji art as before. Empty strings count as
 * "no image".
 */
export function groceryImage(item: GroceryItem, heads: GroceryHead[], subs: GrocerySubHead[]): string | undefined {
  return item.image
    || subs.find((s) => s.id === item.subId)?.image
    || heads.find((h) => h.id === item.headId)?.image
    || undefined;
}

const GROCERY_HEADS_KEY = "canteen-pos-heads-v1";
const GROCERY_SUBHEADS_KEY = "canteen-pos-subheads-v1";
// v2: the old 23-item demo catalogue (canteen-pos-grocery-v1) is replaced
// wholesale by Talha's 390-product catalogue — the v1 key is simply no
// longer read. Nothing real was ever entered into the demo data.
const GROCERY_KEY = "canteen-pos-grocery-v3"; // v3: real-market catalogue (622 entries, brands/variants) — fresh seed for every browser

export function loadGroceryHeads(): GroceryHead[] {
  const seed = () => GROCERY_HEADS_SEED.map((h) => ({ ...h }));
  if (typeof window === "undefined") return seed();
  try {
    const raw = window.localStorage.getItem(GROCERY_HEADS_KEY);
    if (!raw) return seed();
    const parsed = JSON.parse(raw) as GroceryHead[];
    // An empty/invalid list would leave products with nowhere to live —
    // fall back to the seeds rather than break the grocery screens.
    if (!Array.isArray(parsed) || parsed.length === 0) return seed();
    return parsed
      .filter((h) => h && typeof h.id === "string" && typeof h.name === "string")
      .map((h) => ({
        id: h.id,
        name: h.name,
        emoji: typeof h.emoji === "string" && h.emoji ? h.emoji : "🛒",
        tint: typeof h.tint === "string" && h.tint ? h.tint : "#FFF7ED",
      }));
  } catch { return seed(); }
}

export function saveGroceryHeads(list: GroceryHead[]): void {
  try { window.localStorage.setItem(GROCERY_HEADS_KEY, JSON.stringify(list)); } catch {}
}

export function loadGrocerySubHeads(): GrocerySubHead[] {
  const seed = () => GROCERY_SUBHEADS_SEED.map((s) => ({ ...s }));
  if (typeof window === "undefined") return seed();
  try {
    const raw = window.localStorage.getItem(GROCERY_SUBHEADS_KEY);
    if (!raw) return seed();
    const parsed = JSON.parse(raw) as GrocerySubHead[];
    if (!Array.isArray(parsed) || parsed.length === 0) return seed();
    return parsed
      .filter((s) => s && typeof s.id === "string" && typeof s.headId === "string" && typeof s.name === "string")
      .map((s) => ({ id: s.id, headId: s.headId, name: s.name }));
  } catch { return seed(); }
}

export function saveGrocerySubHeads(list: GrocerySubHead[]): void {
  try { window.localStorage.setItem(GROCERY_SUBHEADS_KEY, JSON.stringify(list)); } catch {}
}

export function loadGrocery(): GroceryItem[] {
  const seed = () => SAMPLE_GROCERY.map((g) => ({ ...g, packings: g.packings?.map((k) => ({ ...k })) }));
  if (typeof window === "undefined") return seed();
  try {
    const raw = window.localStorage.getItem(GROCERY_KEY);
    if (!raw) return seed();
    const parsed = JSON.parse(raw) as GroceryItem[];
    if (!Array.isArray(parsed) || !parsed.length) return seed();
    return parsed;
  } catch { return seed(); }
}

export function saveGrocery(items: GroceryItem[]): void {
  try { window.localStorage.setItem(GROCERY_KEY, JSON.stringify(items)); } catch {}
}

// ── STAFF & ROLE-BASED TAB ACCESS (Talha, 14 Nov 2026) ──────────────────────
// Rule: "Jis banday ko jis chez ka access ho usy just uska tab show ho" —
// every staff member sees ONLY the tab(s) the OWNER ticked for them. The
// owner assigns roles from Owner Dashboard → Staff Access. One person may
// hold MULTIPLE tabs. The owner account can never be deleted and can never
// lose the Owner tab (enforced in loadStaff + the Staff Access UI).
// PROTOTYPE HONESTY: PINs are demo-grade and stored locally in plain form,
// exactly like the customer accounts — Phase 2 moves staff to the
// PostgreSQL backend with per-user accounts + hashed passwords.
export type TabKey = "canteen" | "grocery" | "kitchen" | "stock" | "owner" | "online";
export const TABS_META: { key: TabKey; href: string; label: string; short: string; emoji: string }[] = [
  { key: "canteen", href: "/", label: "🍽️ Canteen POS", short: "Canteen", emoji: "🍽️" },
  { key: "grocery", href: "/grocery", label: "🛒 Grocery POS", short: "Grocery", emoji: "🛒" },
  { key: "kitchen", href: "/kitchen", label: "👨‍🍳 Kitchen", short: "Kitchen", emoji: "👨‍🍳" },
  { key: "stock", href: "/stock", label: "📦 Stock", short: "Stock", emoji: "📦" },
  { key: "owner", href: "/owner", label: "📊 Owner Dashboard", short: "Owner", emoji: "📊" },
  { key: "online", href: "/online", label: "📱 Online Order", short: "Online Order", emoji: "📱" },
];
export function tabForPath(path: string): TabKey | null {
  const t = TABS_META.find((x) => x.href === path);
  return t ? t.key : null;
}
export function hrefForTab(key: TabKey): string {
  return TABS_META.find((t) => t.key === key)?.href ?? "/";
}
export function firstTabHref(m: StaffMember): string {
  const first = TABS_META.find((t) => m.tabs.includes(t.key));
  return first ? first.href : "/online";
}

export interface StaffMember {
  id: string;
  name: string;
  pin: string; // 4-digit — DEMO ONLY, plain local storage (hashed server-side in Phase 2)
  tabs: TabKey[]; // the ONLY tabs this person can see/open
  isOwner?: boolean; // exactly one owner — protected: cannot be removed, cannot lose the Owner tab
}

export const STAFF_SEED: StaffMember[] = [
  { id: "staff-owner", name: "Owner", pin: "1234", tabs: ["canteen", "grocery", "kitchen", "stock", "owner", "online"], isOwner: true },
  { id: "staff-canteen", name: "Canteen Wala", pin: "1111", tabs: ["canteen"] },
  { id: "staff-grocery", name: "Grocery Wala", pin: "2222", tabs: ["grocery"] },
  { id: "staff-kitchen", name: "Kitchen Wala", pin: "3333", tabs: ["kitchen"] },
  { id: "staff-stock", name: "Stock Wala", pin: "4444", tabs: ["stock"] },
];

const STAFF_KEY = "canteen-pos-staff-v1";
const STAFF_SESSION_KEY = "canteen-pos-staff-session-v1";

export function loadStaff(): StaffMember[] {
  let list: StaffMember[] = [];
  try {
    const raw = localStorage.getItem(STAFF_KEY);
    if (raw) list = JSON.parse(raw) as StaffMember[];
  } catch { /* ignore */ }
  if (!Array.isArray(list) || list.length === 0) return STAFF_SEED.map((s) => ({ ...s, tabs: [...s.tabs] }));
  // Safety net: an owner (with the Owner tab) must ALWAYS exist — otherwise
  // nobody could ever open Staff Access again. Restore the seed owner.
  if (!list.some((s) => s.isOwner && s.tabs.includes("owner"))) {
    list = [...list, { ...STAFF_SEED[0], tabs: [...STAFF_SEED[0].tabs] }];
  }
  return list;
}
export function saveStaff(list: StaffMember[]) {
  try {
    localStorage.setItem(STAFF_KEY, JSON.stringify(list));
    window.dispatchEvent(new Event("staff-updated"));
  } catch { /* ignore */ }
}
export function setStaffSession(id: string | null) {
  try {
    if (id) localStorage.setItem(STAFF_SESSION_KEY, id);
    else localStorage.removeItem(STAFF_SESSION_KEY);
    window.dispatchEvent(new Event("staff-updated"));
  } catch { /* ignore */ }
}
export function getStaffSessionMember(): StaffMember | null {
  try {
    const id = localStorage.getItem(STAFF_SESSION_KEY);
    if (!id) return null;
    return loadStaff().find((s) => s.id === id) ?? null;
  } catch { return null; }
}
export function useStaffSession(): StaffMember | null {
  const [member, setMember] = useState<StaffMember | null>(null);
  useEffect(() => {
    const read = () => setMember(getStaffSessionMember());
    read();
    window.addEventListener("staff-updated", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("staff-updated", read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return member;
}

// ── STOCK ENTRIES LOG (Stock screen) ─────────────────────────────────────────
// Every backend stock movement the stock keeper makes: stock-IN (purchase)
// and WASTAGE out. Sales are NOT logged here — they decrement stock directly
// in the POS flows. `by` = the logged-in staff member's name.
export interface StockEntry {
  id: string;
  at: string; // ISO date/time
  kind: "canteen" | "grocery"; // which inventory
  itemId: string;
  itemName: string;
  type: "add" | "wastage";
  qty: number;
  unit: string; // "pcs" | "kg" | "piece"
  rate?: number; // purchase rate Rs (add entries)
  supplier?: string; // optional (add entries)
  reason?: string; // expired / damaged / spilled (wastage entries)
  by: string; // staff name who entered it
}
const STOCK_ENTRIES_KEY = "canteen-pos-stock-entries-v1";
export function loadStockEntries(): StockEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STOCK_ENTRIES_KEY);
    return raw ? (JSON.parse(raw) as StockEntry[]) : [];
  } catch { return []; }
}
export function saveStockEntries(entries: StockEntry[]): void {
  try { window.localStorage.setItem(STOCK_ENTRIES_KEY, JSON.stringify(entries)); } catch {}
}

// ── UDHAAR KHATA — customer credit identity + WASOOLI (repayments) ─────────
// Udhaar CHARGES are not a separate record: they are the bills themselves —
// every Order with payment === "Udhaar". The customer's identity is exactly
// what the charge carries, and accounts are keyed by it (never a new
// identity model):
//   • Counter bills (canteen + grocery) store a free-text name only —
//     Order.udhaarName (e.g. "Ahmed — Staff"); no separate ID field.
//   • Online Udhaar orders store the ID separately (Order.customerId) AND
//     embed it in the stored name: Order.udhaarName = "Name (ID: STU-1024)".
// udhaarCustomerOf normalises both shapes to { name, id } + a stable key.
export interface UdhaarCustomer { key: string; name: string; id?: string }
export function udhaarCustomerOf(o: Order): UdhaarCustomer {
  let name = (o.udhaarName ?? "").trim();
  let id = (o.customerId ?? "").trim() || undefined;
  const m = name.match(/^(.*?)\s*\(ID:\s*([^)]+)\)\s*$/);
  if (m) {
    name = m[1].trim();
    if (!id) id = m[2].trim() || undefined;
  }
  if (!name) name = (o.customerName ?? "").trim() || "—";
  return { key: `${name.toLowerCase()}||${(id ?? "").toLowerCase()}`, name, id };
}

// WASOOLI = a repayment against a customer's khata, recorded by staff in
// Owner Dashboard → Udhaar Khata. Wasooli entries are their OWN persisted
// list; every balance anywhere is derived as (udhaar charges − wasooli).
// The bill flow is untouched — wasooli never edits orders.
export type WasooliMethod = "Cash" | "JazzCash" | "Easypaisa" | "Raast" | "Bank";
export const WASOOLI_METHODS: WasooliMethod[] = ["Cash", "JazzCash", "Easypaisa", "Raast", "Bank"];
export interface UdhaarWasooli {
  id: string;
  customerKey: string; // udhaarCustomerOf key — the same identity the charges carry
  customerName: string; // display name as stored on the charges
  customerId?: string; // student/staff ID where the charges carry one
  amount: number; // Rs repaid
  method: WasooliMethod;
  note?: string;
  by: string; // staff member who recorded it (entered-by)
  at: string; // ISO date/time
}
const UDHAAR_WASOOLI_KEY = "canteen-pos-udhaar-wasooli-v1";
export function loadUdhaarWasooli(): UdhaarWasooli[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(UDHAAR_WASOOLI_KEY);
    const parsed = raw ? (JSON.parse(raw) as UdhaarWasooli[]) : [];
    return Array.isArray(parsed) ? parsed.filter((w) => w && typeof w.amount === "number" && typeof w.customerKey === "string") : [];
  } catch { return []; }
}
export function saveUdhaarWasooli(list: UdhaarWasooli[]): void {
  try { window.localStorage.setItem(UDHAAR_WASOOLI_KEY, JSON.stringify(list)); } catch {}
  try { window.dispatchEvent(new Event("udhaar-wasooli-changed")); } catch {}
}

// Legacy constant — the owner PIN now lives in the staff list (seed: Owner /
// 1234, changeable in Owner Dashboard → Staff Access). Kept for reference.
export const OWNER_PIN = "1234";
