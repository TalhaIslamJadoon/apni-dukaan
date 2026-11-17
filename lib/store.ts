// ─────────────────────────────────────────────────────────────────────────────
// Canteen POS data layer — PHASE 2 FACADE (PHASE2-PLAN §5).
//
// Phase 1 kept every exported signature stable so this swap needs no screen
// rewrites: the loaders return an in-memory cache hydrated from the REST
// API, the savers diff against the last-known server state ("shadow") and
// write through the API, and realtime (SSE over the transactional
// event_outbox + a short poll fallback) keeps the cache — and therefore
// every screen — fresh across devices. localStorage is GONE as a data
// store (all Phase 1 data here was sample by design); it survives only for
// tiny client prefs (id-alias map, idempotency keys, guest order tokens).
//
// Money/stock truth lives ONLY on the server: order placement, stock-entry
// posting and payment confirm/reject/reproof move stock transactionally.
// Catalogue saves therefore persist descriptive fields (+ packings /
// variants, and the stock field on an explicit owner product/menu save,
// which the server applies as an audited adjustment) and NEVER write raw
// stock numbers computed by the client.
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPatch, apiPut, apiDelete } from "./api";
import seedData from "./catalog-seed.json";

// ── SHOP SETTINGS (Talha, 14 Nov 2026) ──────────────────────────────────────
// Shop names are placeholders until the real college/canteen names are
// known; the owner edits them in Dashboard → Shop Settings and every
// screen + bill follows. Payment numbers shown at checkout live here too.
export interface ShopSettings {
  collegeName: string;
  canteenName: string;
  groceryName: string;
  jazzcashNumber: string;
  easypaisaNumber: string;
  raastInfo: string;
  wholesaleMinPieces: number; // shop default wholesale minimum (pieces) — Phase 2
  wholesaleMinKg: number; // shop default wholesale minimum (kg) — Phase 2
  shopOpen: boolean; // false → online customers see the closed-shop popup
  closedContactNumber: string; // number shown in the closed-shop popup (owner-editable)
  tableCount: number; // dining tables 1..N (owner-adjustable, 1..100)
  // Business Setup (SALE version): kaunsi dukaan ON hai. `retailType`
  // lib/templates.ts ke 14 retail templates mein se ek key hai, ya null
  // jab sirf canteen ho. First-paint defaults = maujooda install ka
  // behaviour (dono ON, grocery) — server value hydrate hote hi lagta hai.
  hasCanteen: boolean;
  retailType: string | null;
  setupDone: boolean;
  // Board ka Rang (Talha, 16 Nov 2026): display boards (Menu Board +
  // Products Board) ka background rang OWNER khud chunta hai (Settings →
  // Board ka Rang). Default photo wala peela #FFC61A. Server par
  // system_settings.board_color mein rehta hai aur public bootstrap se
  // boards tak pohonchta hai (boards no-login screens hain — naam ki
  // tarah). Boards rang ki roshni se contrast khud banate hain.
  boardColor: string;
  // ── Kiraya / Rentals (Talha, 17 Nov 2026) — Phase 1 parity ──────────
  // rentalsEnabled: rental template se auto-ON, ya Owner Settings toggle.
  // rentalLateFinePerDay: late wapsi ka jurmana Rs/din (server par
  // system_settings.rental_late_fine_per_day_paisa mein paisa mein).
  rentalsEnabled: boolean;
  rentalLateFinePerDay: number;
}
// Board rang ke tayyar presets (Owner → Settings mein swatches).
export const BOARD_COLOR_PRESETS: { name: string; hex: string; dark: boolean }[] = [
  { name: "Peela", hex: "#FFC61A", dark: false },
  { name: "Orange", hex: "#F97316", dark: false },
  { name: "Laal", hex: "#DC2626", dark: true },
  { name: "Sabz", hex: "#16A34A", dark: true },
  { name: "Neela", hex: "#2563EB", dark: true },
  { name: "Gehra Slate", hex: "#0F172A", dark: true },
];

export const SHOP_DEFAULTS: ShopSettings = {
  collegeName: "",
  canteenName: "College Canteen",
  groceryName: "Campus Grocery Store",
  // DEMO placeholders — Talha sets the real numbers in Shop Settings.
  jazzcashNumber: "03XX-XXXXXXX (demo)",
  easypaisaNumber: "03XX-XXXXXXX (demo)",
  raastInfo: "03XX-XXXXXXX (demo Raast ID)",
  wholesaleMinPieces: 10,
  wholesaleMinKg: 5,
  shopOpen: true,
  // DEMO placeholder — Talha sets the real number in Shop Settings.
  closedContactNumber: "0300-0000000 (demo)",
  tableCount: 8,
  hasCanteen: true,
  retailType: "grocery",
  setupDone: true,
  boardColor: "#FFC61A",
  // Rentals default OFF — rental template ya Settings toggle se ON.
  rentalsEnabled: false,
  rentalLateFinePerDay: 500,
};

/** Retail dukaan is setup mein hai ya nahi (retailType null = sirf canteen). */
export function hasRetail(s: ShopSettings): boolean {
  return typeof s.retailType === "string" && s.retailType.length > 0;
}
/** Kiraya (Rental) wala kaam ON hai ya nahi — Rentals tab isi par dikhta hai. */
export function rentalsOn(s: ShopSettings): boolean {
  return s.rentalsEnabled === true;
}
// Static brand block (receipt header etc.) — unchanged from Phase 1.
export const SHOP = {
  systemName: "POS SYSTEM",
  canteenName: "College Canteen",
  groceryName: "Campus Grocery Store",
  tagline: "College Canteen & Campus Grocery Store",
};

// ── CUSTOMER ACCOUNTS (remote online orders) ────────────────────────────────
// Remote orders require an account: mobile number = login ID (any Pakistani
// mobile format is accepted as typed), password ≥ 6 characters, name +
// place label (hostel room / department / office…). Accounts are SERVER
// records now (hashed passwords, opaque session cookie); walk-in and table
// customers still never need one.
export interface CustomerAccount {
  name: string;
  mobile: string; // unique login ID
  password: string; // never returned by the server after login ("" in session DTOs)
  email?: string; // LAZMI (15 Nov 2026) — confirmation code isi par jata hai
  emailVerified?: boolean; // false → account inactive hai: order nahi ho sakta (server bhi block karta hai)
  mobileVerified?: boolean; // optional mobile confirmation ka flag (Skip allowed tha)
  placeType: "Hostel Room" | "Office" | "Other";
  placeDetail: string; // e.g. "Room 12", "Accounts Office"
  placeLabel?: string; // composed "Hostel Room — Room 12" (server DTO convenience)
  studentId?: string; // OPTIONAL — required only for Udhaar
  createdAt: number; // epoch ms
}

export type Category = "Chai" | "Cold Drink" | "Fast Food" | "Nashta" | "Snacks";

// Business modes: ONE system, one billing/payment/stock/report engine,
// shared orders + owner dashboard. Modes have SEPARATE cashier screens
// (top tabs) — a mode never leaks into another mode's screen.
export type BusinessMode = "canteen" | "grocery";
export const BUSINESS_MODE: BusinessMode = "canteen";

export interface MenuItem {
  id: string;
  name: string;
  price: number; // Rs
  cost?: number; // Lagat (Rs) — owner-entered; sirf P&L report ke liye, customer ko kabhi nahi dikhta. undefined = lagat nahi bhari (us item ki bikri munafa mein nahi ginti)
  category: Category;
  emoji: string;
  image?: string; // optional real photo (path/URL) — online 3D picture cards render it in the same frame when set; emoji is the offline-safe fallback art
  images?: string[]; // multi photos (max 16 — gol ghum kar li gayi angles); pehli = main photo. Sirf boards par "ghumta hua" view banta hai — POS/online/lists hamesha MAIN photo hi dikhate hain (rental wala hi system, Talha 18 Nov 2026)
  sku?: string; // optional barcode / SKU — unused by canteen tiles, ready for Grocery Mode
  mode?: BusinessMode; // defaults to BUSINESS_MODE when absent
  stock?: number; // pieces in stock — decremented on every canteen sale (counter + online); managed on the Stock screen
  lowStock?: number; // low-stock threshold in pieces (default 5) — highlighted on the Stock screen
}

export type PaymentMethod = "Cash" | "JazzCash" | "Easypaisa" | "Udhaar" | "Online" | "Counter";

// ── Online payment proof ────────────────────────────────────────────────────
// Rule for ONLINE orders: "payment pehle, order confirm baad mein". The
// customer pays the shop's JazzCash / Easypaisa / Raast / Bank number first
// and uploads a screenshot of the payment as PROOF. The order is created
// with paymentStatus "proof_pending" and NO token — it does NOT reach the
// Kitchen / packing queue. Staff verify the proof in the Dashboard;
// only on Confirm is the token assigned and the order released.
export type ProofPaymentMethod = "JazzCash" | "Easypaisa" | "Raast" | "Bank";
export interface OrderPaymentProof {
  method: ProofPaymentMethod;
  txnId?: string; // transaction ID the customer typed (optional)
  amount: number; // Rs the customer says they paid (= order total at placement)
  proofImage: string; // compressed screenshot — data URL (Phase 2 keeps the data URL inline on the order)
  uploadedAt: number; // epoch ms
}
export type OrderPaymentStatus = "proof_pending" | "confirmed" | "rejected";

/** Ek deal line ke andar ki cheezein — order-time snapshot (naam + qty). */
export interface OrderLineComponent {
  itemId: string; // menu item id
  name: string;
  qty: number; // per ONE deal
}

export interface OrderLine {
  itemId: string;
  name: string;
  price: number;
  qty: number;
  // Deal lines par: deal ke andar ki asal cheezein (server order-time par
  // snapshot freeze karta hai). Kitchen har component alag line mein
  // dikhata hai; receipt deal ke neeche sub-rows print karta hai.
  components?: OrderLineComponent[];
  // Serial-tracked product (mobile shop) ki bikri par har unit ka
  // IMEI/serial — receipt par print hota hai.
  serials?: string[];
}

export interface Order {
  id: string;
  billNo?: string; // sequential unique bill number, e.g. "B-0007" (professional billing)
  mode?: BusinessMode; // "canteen" (default for old records) | "grocery"
  priceType?: "retail" | "wholesale"; // grocery orders
  token: number; // sequential, per day (0 while a proof is pending)
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
  serverId?: string; // Phase 2: the server's uuid (cache keeps the client id for screen continuity)
  clientRequestId?: string; // Phase 2: idempotency key the order was placed with
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

// ── SAMPLE menu (first-paint fallback before the API answers; the server
// seed carries the same items) ──
export const SAMPLE_MENU: MenuItem[] = [
  { id: "chai-1", image: "/images/canteen/chai-1.jpg", name: "Doodh Patti Chai", price: 80, category: "Chai", emoji: "☕" , stock: 60 },
  { id: "chai-2", image: "/images/canteen/chai-2.jpg", name: "Elaichi Chai", price: 100, category: "Chai", emoji: "🫖" , stock: 45 },
  { id: "chai-3", image: "/images/canteen/chai-3.jpg", name: "Green Tea / Qehwa", price: 60, category: "Chai", emoji: "🍵" , stock: 40 },
  { id: "chai-4", image: "/images/canteen/chai-4.jpg", name: "Coffee", price: 150, category: "Chai", emoji: "☕" , stock: 4 },
  { id: "cold-1", image: "/images/canteen/cold-1.jpg", name: "Soft Drink (Can)", price: 80, category: "Cold Drink", emoji: "🥤" , stock: 96 },
  { id: "cold-2", image: "/images/canteen/cold-2.jpg", name: "Soft Drink (1.5L Bottle)", price: 180, category: "Cold Drink", emoji: "🍾" , stock: 24 },
  { id: "cold-3", image: "/images/canteen/cold-3.jpg", name: "Mineral Water (Small)", price: 60, category: "Cold Drink", emoji: "💧" , stock: 120 },
  { id: "cold-4", image: "/images/canteen/cold-4.jpg", name: "Fresh Lime / Lassi", price: 120, category: "Cold Drink", emoji: "🥛" , stock: 30 },
  { id: "cold-5", image: "/images/canteen/cold-5.jpg", name: "Juice (Pack)", price: 70, category: "Cold Drink", emoji: "🧃" , stock: 72 },
  { id: "fast-1", image: "/images/canteen/fast-1.jpg", name: "Chicken Burger", price: 350, category: "Fast Food", emoji: "🍔" , stock: 35 },
  { id: "fast-2", image: "/images/canteen/fast-2.jpg", name: "Zinger Burger", price: 450, category: "Fast Food", emoji: "🍔" , stock: 3 },
  { id: "fast-3", image: "/images/canteen/fast-3.jpg", name: "Chicken Shawarma", price: 250, category: "Fast Food", emoji: "🌯" , stock: 28 },
  { id: "fast-4", image: "/images/canteen/fast-4.jpg", name: "Fries (Regular)", price: 150, category: "Fast Food", emoji: "🍟" , stock: 50 },
  { id: "fast-5", image: "/images/canteen/fast-5.jpg", name: "Chicken Biryani", price: 300, category: "Fast Food", emoji: "🍛" , stock: 26 },
  { id: "fast-6", image: "/images/canteen/fast-6.jpg", name: "Daal Chawal", price: 220, category: "Fast Food", emoji: "🍚" , stock: 32 },
  { id: "nash-1", image: "/images/canteen/nash-1.jpg", name: "Halwa Puri Set", price: 250, category: "Nashta", emoji: "🫓" , stock: 22 },
  { id: "nash-2", image: "/images/canteen/nash-2.jpg", name: "Anda Paratha", price: 180, category: "Nashta", emoji: "🍳" , stock: 30 },
  { id: "nash-3", image: "/images/canteen/nash-3.jpg", name: "Plain Paratha", price: 80, category: "Nashta", emoji: "🫓" , stock: 45 },
  { id: "nash-4", image: "/images/canteen/nash-4.jpg", name: "Omelette + Toast", price: 200, category: "Nashta", emoji: "🥚" , stock: 18 },
  { id: "snk-1", image: "/images/canteen/snk-1.jpg", name: "Samosa (1 pc)", price: 50, category: "Snacks", emoji: "🔺" , stock: 80 },
  { id: "snk-2", image: "/images/canteen/snk-2.jpg", name: "Pakora (Plate)", price: 150, category: "Snacks", emoji: "🧆" , stock: 40 },
  { id: "snk-3", image: "/images/canteen/snk-3.jpg", name: "Roll Paratha", price: 200, category: "Snacks", emoji: "🌮" , stock: 25 },
  { id: "snk-4", image: "/images/canteen/snk-4.jpg", name: "Biscuits (Pack)", price: 50, category: "Snacks", emoji: "🍪" , stock: 60 },
  { id: "snk-5", image: "/images/canteen/snk-5.jpg", name: "Chips (Pack)", price: 60, category: "Snacks", emoji: "🍿" , stock: 90 },
  { id: "snk-6", image: "/images/canteen/snk-6.jpg", name: "Chocolate", price: 100, category: "Snacks", emoji: "🍫" , stock: 55 },
];

// ── Pure order helpers (unchanged Phase 1 semantics) ────────────────────────
function todayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
export function isToday(o: Order): boolean {
  return o.createdAt.slice(0, 10) === todayKey();
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
  if (o.billNo) return o.billNo;
  const m = o.id.match(/(\d+)$/);
  return `B-${String(m ? parseInt(m[1], 10) : 0).padStart(4, "0")}`;
}
export function nextToken(orders: Order[], mode?: BusinessMode): number {
  // Per-shop tokens (Talha, 15 Nov 2026): canteen aur grocery ki apni
  // apni daily counting — mode diya jaye to sirf usi dukaan ke aaj ke
  // tokens dekhe jate hain. (Phase 2 mein asal token server deta hai; ye
  // sirf local estimate hai.)
  const todays = orders
    .filter((o) => isToday(o) && (mode === undefined || (o.mode ?? "canteen") === mode))
    .map((o) => o.token || 0);
  return (todays.length ? Math.max(...todays) : 0) + 1;
}
/**
 * Fulfilment gate for the payment-proof flow: an order may reach the
 * Kitchen / grocery packing queue only when its payment is cleared —
 * paymentStatus undefined (all normal orders) or "confirmed".
 */
export function isPaymentCleared(o: Order): boolean {
  return o.paymentStatus === undefined || o.paymentStatus === "confirmed";
}

// ── GROCERY MODE — 3-LEVEL STRUCTURE: Main Head → Sub Head → Product ────────
// Every product lives in exactly ONE sub-head; every sub-head in ONE main
// head. Brand is part of the product identity (Sunsilk ≠ Pantene); flavours
// / types are VARIANTS under the master; sizes are PACKINGS of a variant.
// A sold variant+packing bills as `Name (Variant · Packing)`.
export interface PackingOption {
  label: string; // a SIZE of the variant ("500g", "1kg") or a sealed-pack count ("Snack Pack", "Full Dabba")
  retailPrice: number;
  wholesalePrice: number;
  barcode?: string; // Phase 2: each packing carries its OWN EAN barcode
  containsQty?: number; // Phase 2: sealed packs inside this packing (smallest pack = 1, Full Dabba = N) — stock counts packs for these
  wholesaleMinQty?: number; // Phase 2: optional per-packing wholesale minimum (packs); undefined = product/shop default
}

export interface GroceryVariant {
  name: string; // flavour / type: "Black", "Pink", "Anti-Dandruff", "Mango" — "Standard" = no flavours
  packings: PackingOption[];
}

export interface GroceryItem {
  id: string;
  name: string;
  brand?: string | null; // Phase 2: company/brand — part of the product identity, searchable
  headId: string; // main head this product lives under (GroceryHead.id)
  subId: string; // sub-head id — namespaced `${headId}:${subSlug}`, unique across heads
  sku: string; // shop SKU / PLU code (typed or scanned) — loose per-kg items are sold by this
  barcode?: string; // EAN barcode on packed/branded products — the counter scanner reads THIS first, then SKU
  retailPrice: number; // Rs — per piece, or per kg when unit === "kg"
  wholesalePrice: number; // Rs
  wholesaleMinQty?: number | null; // optional per-product wholesale minimum, in this product's unit (base packs for packing lines); null/undefined = shop default
  stock: number; // base units: pieces (or packs for count products), or kg when unit === "kg"
  unit: "piece" | "kg";
  lowStock?: number; // low-stock threshold (default: 5 pcs / 2 kg) — highlighted on the Stock screen
  // Owner-controlled: show this product on the Products Board's "🎉 Aaj ki
  // Offers" slide (/grocery-board). Optional — records saved before this
  // field existed simply have it missing, which everywhere means false.
  boardOffer?: boolean;
  // REAL offer price (Rs) for the boardOffer item — Talha's rule (15 Nov
  // 2026): "Biscuits pehle 200 ke thay, ab offer mein 180 ke kar rahe
  // hain." ACTIVE only when boardOffer is on AND 0 < offerPrice <
  // retailPrice (see offerActive). It replaces the item's REPRESENTATIVE
  // retail price (this base retailPrice field — which is also the price of
  // exactly one packing, see offerPackingOf) on the Products Board offers
  // slide, in Sell retail billing and in the /online grocery
  // catalogue/orders (the server re-charges it — client prices are never
  // trusted). Other packings keep their own prices; wholesale is NEVER
  // touched. Optional — missing/0 means "no offer price".
  offerPrice?: number;
  // Mobile shops ka khaas flag: aise product ki bikri par har unit ka
  // IMEI/serial lazmi likha jata hai (retail POS pay modal) aur bill par
  // print hota hai. Owner product form mein checkbox sirf tab dikhta hai
  // jab retailType "mobile" ho.
  trackSerial?: boolean;
  emoji: string;
  image?: string; // optional real photo — same 3D picture-card frame as the canteen items when set
  images?: string[]; // multi photos (max 16 — gol ghum kar li gayi angles); pehli = main photo. Sirf Products Board par "ghumta hua" view banta hai — POS/online/lists hamesha MAIN photo hi dikhate hain (rental wala hi system, Talha 18 Nov 2026)
  // Sizes of the product's Standard variant (Talha's rule: a size is a
  // PACKING of one product, never a separate item). A sold packing bills as
  // `Name (Label)` at the packing's own price.
  packings?: PackingOption[];
  // Phase 2: ALL variants incl. "Standard" (whose packings mirror
  // `packings`). Masters with real flavours expose them here; the POS asks
  // variant first, then packing.
  variants?: GroceryVariant[];
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

interface CatalogProduct {
  id: string; name: string; sku: string; barcode?: string;
  retailPrice: number; wholesalePrice: number; stock: number;
  unit: "piece" | "kg"; emoji: string; packings?: PackingOption[]; image?: string; images?: string[];
}
interface CatalogSub { id: string; name: string; image?: string; products: CatalogProduct[]; }
interface CatalogHead { id: string; name: string; emoji: string; image?: string; subs: CatalogSub[]; }
const CATALOG_HEADS = (seedData as unknown as { heads: CatalogHead[] }).heads;

// Soft pastel tints — one per seeded head, same family as the old section tints.
const HEAD_TINTS = [
  "#FFFBEB", "#FEF9C3", "#FDF2F8", "#EFF6FF", "#F0FDF4",
  "#FFF7ED", "#FEF2F2", "#FDF4FF", "#ECFEFF", "#E0F2FE",
  "#F5F3FF", "#FDF2F8", "#F0FDF4", "#E0F2FE", "#F5F3FF",
  "#FFFBEB", "#EFF6FF", "#FEF9C3", "#FEF2F2", "#F5F5F4",
];

export const GROCERY_HEADS_SEED: GroceryHead[] = CATALOG_HEADS.map((h, i) => {
  const head: GroceryHead = { id: h.id, name: h.name, emoji: h.emoji, tint: HEAD_TINTS[i % HEAD_TINTS.length] };
  if (h.image) head.image = h.image;
  return head;
});

export const GROCERY_SUBHEADS_SEED: GrocerySubHead[] = CATALOG_HEADS.flatMap((h) =>
  h.subs.map((s) => {
    const sub: GrocerySubHead = { id: `${h.id}:${s.id}`, headId: h.id, name: s.name };
    if (s.image) sub.image = s.image;
    return sub;
  })
);

const BOARD_OFFER_SEED_IDS = new Set(["p-14101", "p-08106", "p-10101", "p-12101"]); // Surf Excel · Peek Freans Rio · Coca-Cola · Cadbury Dairy Milk
// One seeded item also carries a REAL offer price so the dual-rate board
// display is visible on a fresh seed: Peek Freans Rio retail Rs 80 → 70.
const OFFER_PRICE_SEED: Record<string, number> = { "p-08106": 70 };

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
      if (BOARD_OFFER_SEED_IDS.has(p.id)) item.boardOffer = true;
      if (OFFER_PRICE_SEED[p.id]) item.offerPrice = OFFER_PRICE_SEED[p.id];
      return item;
    })
  )
);

/**
 * Offer pricing (Talha, 15 Nov 2026 — mirrors the server rule in
 * server/services/orders.ts). An offer price is ACTIVE only when the
 * product is flagged for the board AND has a real offer price below its
 * representative retail price. The offer replaces ONLY that representative
 * price: the item's base `retailPrice`, which by catalogue construction is
 * also the retail price of exactly ONE packing (the product's "main" size
 * — e.g. Coca-Cola base 200 = its 1.5L packing). Every other packing keeps
 * its own price; wholesale is never affected.
 */
export function offerActive(it: GroceryItem): boolean {
  return it.boardOffer === true
    && typeof it.offerPrice === "number" && it.offerPrice > 0
    && it.offerPrice < it.retailPrice;
}

/** The packing whose retail price IS the item's representative price. */
export function offerPackingOf(it: GroceryItem): PackingOption | undefined {
  if (!offerActive(it) || !it.packings) return undefined;
  return it.packings.find((p) => p.retailPrice === it.retailPrice);
}

/** Effective BASE retail price — the offer price when an offer is active. */
export function effectiveRetail(it: GroceryItem): number {
  return offerActive(it) ? (it.offerPrice as number) : it.retailPrice;
}

/** Effective retail price of ONE packing — only the representative
 *  packing (offerPackingOf) follows the offer; all others keep theirs. */
export function effectivePackingRetail(it: GroceryItem, p: PackingOption): number {
  const op = offerPackingOf(it);
  return op && op.label === p.label ? (it.offerPrice as number) : p.retailPrice;
}

/** True when selling this exact line (base product or one packing) at
 *  retail charges the offer price — used for the "(Offer)" receipt tag. */
export function lineIsOffer(it: GroceryItem, packing?: PackingOption): boolean {
  if (!offerActive(it)) return false;
  if (!packing) return true;
  const op = offerPackingOf(it);
  return !!op && op.label === packing.label;
}

/**
 * Picture fallback: the product's own picture → its sub-head's → its head's
 * → undefined (the tile renders the emoji art as before).
 */
export function groceryImage(item: GroceryItem, heads: GroceryHead[], subs: GrocerySubHead[]): string | undefined {
  return item.image
    || subs.find((s) => s.id === item.subId)?.image
    || heads.find((h) => h.id === item.headId)?.image
    || undefined;
}

// ── STAFF & ROLE-BASED TAB ACCESS ───────────────────────────────────────────
// Every staff member sees ONLY the tab(s) the OWNER granted. Phase 2: the
// grants live on the server and are enforced there too — a role receives
// 403 from endpoints outside its tabs. Credentials are hashed server-side;
// the list endpoint never returns PIN material (pin is "" in DTOs).
export type TabKey = "canteen" | "grocery" | "rentals" | "kitchen" | "stock" | "owner" | "online";
export const TABS_META: { key: TabKey; href: string; label: string; short: string; emoji: string }[] = [
  { key: "canteen", href: "/", label: "🍽️ Canteen POS", short: "Canteen", emoji: "🍽️" },
  { key: "grocery", href: "/grocery", label: "🛒 Sell", short: "Sell", emoji: "🛒" },
  { key: "rentals", href: "/rentals", label: "👰 Rentals", short: "Rentals", emoji: "👰" },
  { key: "kitchen", href: "/kitchen", label: "👨‍🍳 Kitchen", short: "Kitchen", emoji: "👨‍🍳" },
  { key: "stock", href: "/stock", label: "📦 Inventory", short: "Inventory", emoji: "📦" },
  { key: "owner", href: "/owner", label: "📊 Dashboard", short: "Dashboard", emoji: "📊" },
  { key: "online", href: "/online", label: "📱 Online Orders", short: "Online Orders", emoji: "📱" },
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
  pin: string; // always "" from the server — credentials are never shipped to clients
  tabs: TabKey[]; // the ONLY tabs this person can see/open (server-enforced)
  isOwner?: boolean; // exactly one owner — protected server-side too
}

export const OWNER_PIN = "1234";
export const STAFF_SEED: StaffMember[] = [
  { id: "staff-owner", name: "Owner", pin: "1234", tabs: ["canteen", "grocery", "rentals", "kitchen", "stock", "owner", "online"], isOwner: true },
  { id: "staff-canteen", name: "Canteen Wala", pin: "1111", tabs: ["canteen"] },
  { id: "staff-grocery", name: "Grocery Wala", pin: "2222", tabs: ["grocery"] },
  { id: "staff-kitchen", name: "Kitchen Wala", pin: "3333", tabs: ["kitchen"] },
  { id: "staff-stock", name: "Stock Wala", pin: "4444", tabs: ["stock"] },
];

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
  expiry?: string; // "YYYY-MM" — medical shops: stock-IN par optional expiry mahina
  by: string; // staff name who entered it
  serverId?: string;
}

// ── CANTEEN DEALS (KFC-style combos) ────────────────────────────────────────
// Ek deal = kai menu items, EK deal price. Bikri par deal EK order line
// banti hai (itemId "deal:<id>", naam "🎁 <Deal Name>", price = deal
// price) jiss ke sath components ka snapshot lagta hai — Kitchen har
// component alag dikhata hai aur stock asal items se katta hai (server
// transaction ke andar). Deal ki kul qeemat hamesha CURRENT menu prices
// se banti hai (dealValue) — owner ko bachat wazeh dikhta hai.
export interface Deal {
  id: string;
  name: string;
  items: { menuItemId: string; qty: number }[];
  price: number; // Rs — deal ki apni price (kul qeemat se kam)
  active: boolean;
}

export const SAMPLE_DEALS: Deal[] = [
  {
    id: "deal-student", name: "Student Deal", price: 600, active: true,
    items: [
      { menuItemId: "fast-2", qty: 1 }, // Zinger Burger 450
      { menuItemId: "fast-4", qty: 1 }, // Fries (Regular) 150
      { menuItemId: "cold-1", qty: 1 }, // Soft Drink (Can) 80 → kul 680
    ],
  },
  {
    id: "deal-family", name: "Family Deal", price: 850, active: true,
    items: [
      { menuItemId: "fast-5", qty: 2 }, // Chicken Biryani ×2 = 600
      { menuItemId: "fast-6", qty: 1 }, // Daal Chawal 220
      { menuItemId: "cold-2", qty: 1 }, // Soft Drink 1.5L 180 → kul 1000
    ],
  },
];

/** Deal ke components — menu ke sath resolve karke (missing items skip). */
export function dealComponents(deal: Deal, menu: MenuItem[]): { item: MenuItem; qty: number }[] {
  return deal.items
    .map((i) => ({ item: menu.find((m) => m.id === i.menuItemId), qty: i.qty }))
    .filter((c): c is { item: MenuItem; qty: number } => !!c.item && c.qty > 0);
}

/** Deal ki kul qeemat CURRENT menu prices par (bachat ka hisaab). */
export function dealValue(deal: Deal, menu: MenuItem[]): number {
  return dealComponents(deal, menu).reduce((s, c) => s + c.item.price * c.qty, 0);
}

/** "Zinger Burger ×1 · Fries (Regular) ×1 · Soft Drink (Can) ×1" */
export function dealContentsText(deal: Deal, menu: MenuItem[]): string {
  return dealComponents(deal, menu).map((c) => `${c.item.name} ×${c.qty}`).join(" · ");
}

/** Deal ko order line mein badlein — components snapshot ke sath. */
export function dealOrderLine(deal: Deal, menu: MenuItem[], qty = 1): OrderLine {
  return {
    itemId: `deal:${deal.id}`,
    name: `🎁 ${deal.name}`,
    price: deal.price,
    qty,
    components: dealComponents(deal, menu).map((c) => ({ itemId: c.item.id, name: c.item.name, qty: c.qty })),
  };
}

// ── EXPENSES (Kharchay) — P&L ka kharcha register ───────────────────────────
// Dukaan ke kharchay (bijli, gas, tankhwah, kiraya…) owner yahan darj
// karta hai; P&L report inhein Kharchay ki line mein gin ti hai. "both"
// wala kharcha sirf combined column mein ginta hai (server rule).
export interface Expense {
  id: string;
  dateISO: string; // "YYYY-MM-DD"
  title: string;
  amount: number; // Rs
  shop: "canteen" | "grocery" | "both";
  note?: string;
}

// ── Medical expiry helpers ──────────────────────────────────────────────────
const EXPIRY_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11" → "Nov 2026" */
export function expiryLabel(ym: string): string {
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  if (!m) return ym;
  return `${EXPIRY_MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/**
 * Expiry ke qareeb (ya guzri hui) products — har product ki SAB SE JALDI
 * wali recorded stock-IN expiry se. Mahina khatam hone ki tareekh us
 * mahine ka aakhri din mani jati hai. 30 din ke andar ya guzar chuki
 * entries, sab se jaldi wali pehle. NOTE: ye sirf warning hai —
 * batch-wise hisaab (konsi batch pehle biki) is version mein nahi hai.
 */
export function expiringProducts(
  items: GroceryItem[],
  entries: StockEntry[],
  now = new Date()
): { item: GroceryItem; expiry: string; daysLeft: number }[] {
  const soonest = new Map<string, string>();
  for (const e of entries) {
    if (e.kind !== "grocery" || e.type !== "add" || !e.expiry) continue;
    const cur = soonest.get(e.itemId);
    if (!cur || e.expiry < cur) soonest.set(e.itemId, e.expiry);
  }
  const out: { item: GroceryItem; expiry: string; daysLeft: number }[] = [];
  for (const item of items) {
    const ym = soonest.get(item.id);
    if (!ym) continue;
    const m = ym.match(/^(\d{4})-(\d{2})$/);
    if (!m) continue;
    const end = new Date(Number(m[1]), Number(m[2]), 0, 23, 59, 59); // mahine ka aakhri din
    const daysLeft = Math.ceil((end.getTime() - now.getTime()) / 86400000);
    if (daysLeft <= 30) out.push({ item, expiry: ym, daysLeft });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

// ── KIRAYA / RENTALS — types (Phase 1 parity, Talha 17 Nov 2026) ───────────
// Rental ITEM grocery product NAHI hai: har dress EK unique piece hai
// jis ki apni status hai. Booking ka paisa: advance (booking par) +
// baqaya (pickup par) + settlement (wapsi par late fine/damage, security
// se katoti). Deposit amanat hai — aamdani sirf wasool shuda kiraya +
// fine + damage, cash-basis (rentalMoneyEvents), jo P&L (server) aur
// Owner Overview mein ginta hai.
export type RentalItemStatus = "available" | "booked" | "out" | "cleaning" | "inactive";
// Rental CATEGORIES — shadi ke functions + aam event samaan (preset list;
// owner form mein nayi category free-text bhi likh sakta hai).
export const RENTAL_CATEGORIES = [
  "Baraat", "Walima", "Mehndi", "Dholki", "Mayoun", "Bridal", "Groom",
  "Party/Event", "Kids", "Sajawat / Decor", "Lights", "Sign Boards",
] as const;
export const RENTAL_CATEGORY_EMOJI: Record<string, string> = {
  "Baraat": "💍", "Walima": "🌙", "Mehndi": "🌿", "Dholki": "🪘", "Mayoun": "🌼",
  "Bridal": "👰", "Groom": "🤵", "Party/Event": "🎉", "Kids": "🎀",
  "Sajawat / Decor": "🌸", "Lights": "💡", "Sign Boards": "🪧",
};
export function rentalCategoryEmoji(cat?: string): string {
  return (cat && RENTAL_CATEGORY_EMOJI[cat]) || "👗";
}
export interface RentalItem {
  id: string;
  name: string;
  category?: string; // shadi ka function / qisam (Baraat, Walima, Lights…)
  totalQty: number; // kul pieces (dresses 1; lights waghera zyada)
  bookedQty?: number; // server-computed: active bookings ki kul qty (board/availability ke liye)
  size?: string;
  color?: string;
  rentPerDay: number;
  securityDeposit: number;
  emoji: string;
  image?: string;
  images?: string[]; // multi photos (max 16); pehli = main photo
  status: RentalItemStatus;
  // OFFER (grocery offerPrice parity): active sirf jab boardOffer ON ho
  // AUR 0 < offerRentPerDay < rentPerDay. Booking effective kiraye par.
  offerRentPerDay?: number;
  boardOffer?: boolean;
}
export const RENTAL_ITEM_STATUSES: RentalItemStatus[] = ["available", "booked", "out", "cleaning", "inactive"];
export const RENTAL_STATUS_META: Record<RentalItemStatus, { label: string; bg: string; fg: string }> = {
  available: { label: "✅ Available — Khali Hai", bg: "#DCFCE7", fg: "#166534" },
  booked: { label: "📅 Booked", bg: "#FEF3C7", fg: "#92400E" },
  out: { label: "👰 Bahar Gayi Hui", bg: "#DBEAFE", fg: "#1D4ED8" },
  cleaning: { label: "🧺 Dry-Clean / Repair", bg: "#F3E8FF", fg: "#7E22CE" },
  inactive: { label: "🚫 Band (Inactive)", bg: "#E7E5E4", fg: "#57534E" },
};
export type RentalBookingStatus = "booked" | "out" | "completed" | "cancelled";
export type SecurityKind = "Cash" | "CNIC" | "Cheque";
export const SECURITY_KINDS: SecurityKind[] = ["Cash", "CNIC", "Cheque"];
export type ReturnCondition = "theek" | "damage" | "cleaning";
export interface RentalBooking {
  id: string;
  bookingNo: string;
  itemId: string;
  itemName: string;
  qty: number; // book hue pieces (dress = 1)
  customerName: string;
  customerMobile: string;
  customerCnic?: string;
  pickupDate: string;
  returnDate: string;
  days: number;
  rentPerDay: number; // CHARGE hua roz ka kiraya (offer lagi ho to offer wala)
  listRentPerDay?: number; // offer lagi ho to asal roz ka kiraya (snapshot)
  rentTotal: number;
  securityDeposit: number;
  securityKind: SecurityKind;
  advancePaid: number;
  balancePaid: number;
  status: RentalBookingStatus;
  pickedUpAt?: string;
  returnedAt?: string;
  actualReturnDate?: string;
  lateDays?: number;
  lateFinePerDay: number;
  lateFine?: number;
  damageCharges?: number;
  damageNote?: string;
  returnCondition?: ReturnCondition;
  securityDeducted?: number;
  securityRefunded?: number;
  extraDue?: number;
  createdAt: string;
  by?: string;
}
// Demo dresses — server templates-data.ts ki RENTAL_SEED_ITEMS se sync
// rakhein (wahan se DB mein seed hoti hain); ye copy sirf reference hai.
export const RENTAL_ITEMS_SEED: RentalItem[] = [
  // ── Baraat ──
  { id: "rent-1", name: "Laal Bridal Lehenga", category: "Baraat", totalQty: 1, size: "M", color: "Laal", rentPerDay: 5000, securityDeposit: 30000, emoji: "👰", image: "/images/rentals/rent-1.jpg", images: ["/images/rentals/rent-1.jpg", "/images/rentals/rent-1-2.jpg", "/images/rentals/rent-1-3.jpg", "/images/rentals/rent-1-4.jpg"], status: "available" },
  { id: "rent-2", name: "Mehroon Bridal Lehenga", category: "Baraat", totalQty: 1, size: "L", color: "Mehroon", rentPerDay: 6500, securityDeposit: 40000, emoji: "👰", image: "/images/rentals/rent-2.jpg", status: "available" },
  { id: "rent-3", name: "Cream Sherwani", category: "Baraat", totalQty: 1, size: "L", color: "Cream", rentPerDay: 3500, securityDeposit: 20000, emoji: "🤵", image: "/images/rentals/rent-3.jpg", status: "available" },
  // ── Walima ──
  { id: "rent-4", name: "Peach Walima Maxi", category: "Walima", totalQty: 1, size: "M", color: "Peach", rentPerDay: 3500, securityDeposit: 20000, emoji: "👗", image: "/images/rentals/rent-4.jpg", images: ["/images/rentals/rent-4.jpg", "/images/rentals/rent-4-2.jpg", "/images/rentals/rent-4-3.jpg", "/images/rentals/rent-4-4.jpg"], status: "available" },
  { id: "rent-5", name: "Golden Walima Gown", category: "Walima", totalQty: 1, size: "M", color: "Golden", rentPerDay: 4000, securityDeposit: 25000, emoji: "👗", offerRentPerDay: 3200, boardOffer: true, image: "/images/rentals/rent-5.jpg", status: "available" },
  { id: "rent-6", name: "Kaala Prince Coat", category: "Walima", totalQty: 1, size: "M", color: "Kaala", rentPerDay: 2500, securityDeposit: 15000, emoji: "🧥", image: "/images/rentals/rent-6.jpg", status: "available" },
  // ── Mehndi ──
  { id: "rent-7", name: "Peeli Mehndi Dress", category: "Mehndi", totalQty: 1, size: "S", color: "Peela / Hara", rentPerDay: 2000, securityDeposit: 10000, emoji: "💛", image: "/images/rentals/rent-7.jpg", status: "available" },
  { id: "rent-8", name: "Hara Mehndi Lehenga", category: "Mehndi", totalQty: 1, size: "M", color: "Hara / Narangi", rentPerDay: 2800, securityDeposit: 15000, emoji: "🧡", image: "/images/rentals/rent-8.jpg", status: "available" },
  { id: "rent-9", name: "Safed Kurta Waistcoat", category: "Mehndi", totalQty: 1, size: "L", color: "Safed", rentPerDay: 1800, securityDeposit: 8000, emoji: "👔", image: "/images/rentals/rent-9.jpg", status: "available" },
  // ── Dholki ──
  { id: "rent-10", name: "Sarson Dholki Suit", category: "Dholki", totalQty: 1, size: "M", color: "Sarson", rentPerDay: 1500, securityDeposit: 8000, emoji: "🌼", image: "/images/rentals/rent-10.jpg", status: "available" },
  { id: "rent-11", name: "Peeli Dholki Dress", category: "Dholki", totalQty: 1, size: "S", color: "Peela", rentPerDay: 1600, securityDeposit: 8000, emoji: "💛", image: "/images/rentals/rent-11.jpg", status: "available" },
  // ── Mayoun ──
  { id: "rent-12", name: "Peela Mayoun Suit", category: "Mayoun", totalQty: 1, size: "M", color: "Peela", rentPerDay: 1200, securityDeposit: 6000, emoji: "🌻", image: "/images/rentals/rent-12.jpg", status: "available" },
  // ── Bridal (dulhan sets) ──
  { id: "rent-13", name: "Gulabi Sharara Set", category: "Bridal", totalQty: 1, size: "M", color: "Gulabi", rentPerDay: 3000, securityDeposit: 18000, emoji: "🌸", image: "/images/rentals/rent-13.jpg", status: "available" },
  { id: "rent-14", name: "Safed Bridal Gown", category: "Bridal", totalQty: 1, size: "M", color: "Safed", rentPerDay: 4500, securityDeposit: 25000, emoji: "👰", image: "/images/rentals/rent-14.jpg", status: "available" },
  // ── Groom (dulha) ──
  { id: "rent-15", name: "Golden Sherwani", category: "Groom", totalQty: 1, size: "L", color: "Golden", rentPerDay: 4000, securityDeposit: 22000, emoji: "🤵", image: "/images/rentals/rent-15.jpg", status: "available" },
  { id: "rent-16", name: "Dulha Sherwani Set", category: "Groom", totalQty: 1, size: "L", color: "Kaala / Golden", rentPerDay: 5500, securityDeposit: 30000, emoji: "🤵", image: "/images/rentals/rent-16.jpg", status: "available" },
  // ── Party / Event ──
  { id: "rent-17", name: "Neeli Party Gown", category: "Party/Event", totalQty: 1, size: "M", color: "Neela", rentPerDay: 2500, securityDeposit: 15000, emoji: "👗", offerRentPerDay: 1999, boardOffer: true, image: "/images/rentals/rent-17.jpg", status: "available" },
  { id: "rent-18", name: "Kaali Party Frock", category: "Party/Event", totalQty: 1, size: "S", color: "Kaala", rentPerDay: 1800, securityDeposit: 10000, emoji: "🖤", image: "/images/rentals/rent-18.jpg", status: "available" },
  // ── Kids ──
  { id: "rent-19", name: "Gulabi Kids Frock", category: "Kids", totalQty: 1, size: "Bache (6–8 saal)", color: "Gulabi", rentPerDay: 800, securityDeposit: 5000, emoji: "🎀", image: "/images/rentals/rent-19.jpg", status: "available" },
  { id: "rent-20", name: "Kids Cream Sherwani", category: "Kids", totalQty: 1, size: "Bache (5–7 saal)", color: "Cream", rentPerDay: 1000, securityDeposit: 6000, emoji: "🤵", image: "/images/rentals/rent-20.jpg", status: "available" },
  // ── Sajawat / Decor ──
  { id: "rent-21", name: "Sajawat Dholki", category: "Sajawat / Decor", totalQty: 6, color: "Multicolor", rentPerDay: 500, securityDeposit: 3000, emoji: "🪘", image: "/images/rentals/rent-21.jpg", status: "available" },
  { id: "rent-22", name: "Genda Phool Sajawat", category: "Sajawat / Decor", totalQty: 4, color: "Peela / Narangi", rentPerDay: 800, securityDeposit: 4000, emoji: "🌼", image: "/images/rentals/rent-22.jpg", status: "available" },
  // ── Lights ──
  { id: "rent-23", name: "String Lights", category: "Lights", totalQty: 20, color: "Warm White", rentPerDay: 300, securityDeposit: 2000, emoji: "💡", image: "/images/rentals/rent-23.jpg", status: "available" },
  { id: "rent-24", name: "Stage Light", category: "Lights", totalQty: 8, color: "RGB", rentPerDay: 700, securityDeposit: 5000, emoji: "🔦", image: "/images/rentals/rent-24.jpg", status: "available" },
  // ── Sign Boards ──
  { id: "rent-25", name: "Shadi Mubarak Neon Sign", category: "Sign Boards", totalQty: 2, color: "Gulabi Neon", rentPerDay: 1500, securityDeposit: 8000, emoji: "✨", image: "/images/rentals/rent-25.jpg", status: "available" },
  { id: "rent-26", name: "Mehndi Board", category: "Sign Boards", totalQty: 3, color: "Hara", rentPerDay: 600, securityDeposit: 3000, emoji: "🪧", image: "/images/rentals/rent-26.jpg", status: "available" },
  { id: "rent-27", name: "Welcome Board", category: "Sign Boards", totalQty: 2, color: "Safed / Golden", rentPerDay: 700, securityDeposit: 3000, emoji: "🪧", image: "/images/rentals/rent-27.jpg", status: "available" },
];
export function rentalDaysBetween(pickup: string, ret: string): number {
  const a = Date.parse(`${pickup}T00:00:00`);
  const b = Date.parse(`${ret}T00:00:00`);
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}
/** Dress ki offer ACTIVE hai? Grocery ke offerActive wala exact rule:
 *  board-offer flag ON ho AUR 0 < offerRentPerDay < rentPerDay. */
export function rentalOfferActive(i: RentalItem): boolean {
  return i.boardOffer === true && typeof i.offerRentPerDay === "number"
    && i.offerRentPerDay > 0 && i.offerRentPerDay < i.rentPerDay;
}
/** Booking jis kiraye par banti hai — offer active ho to offer wala,
 *  warna asal kiraya. (Grocery ke effectiveRetail ka rental version.) */
export function effectiveRentPerDay(i: RentalItem): number {
  return rentalOfferActive(i) ? (i.offerRentPerDay as number) : i.rentPerDay;
}
/** Dress ki photos (multi-photo, board ke "ghumta hua" view ke liye) —
 *  images[] ho to wohi, warna purana single image, warna khali (emoji). */
export function rentalPhotos(i: RentalItem): string[] {
  if (Array.isArray(i.images) && i.images.length) return i.images.filter((u) => typeof u === "string" && u);
  return i.image ? [i.image] : [];
}
/** Kisi bhi cheez (menu item / grocery product) ki photos — rentalPhotos
 *  wala hi rule, generic: images[] ho to wohi, warna single image, warna
 *  khali (emoji). Boards ka PhotoCycle inhi par ghumta hai. */
export function itemPhotos(x: { image?: string; images?: string[] }): string[] {
  if (Array.isArray(x.images) && x.images.length) return x.images.filter((u) => typeof u === "string" && u);
  return x.image ? [x.image] : [];
}
/** Ek item ke kitne piece active bookings (booked + out) mein gaye hue hain. */
export function rentalBookedQty(bookings: RentalBooking[], itemId: string): number {
  return bookings
    .filter((b) => b.itemId === itemId && (b.status === "booked" || b.status === "out"))
    .reduce((s, b) => s + (b.qty || 1), 0);
}
/** Abhi kitne piece available hain — bookings diye hon to un se hisaab,
 *  warna item par ayi server ki bookedQty se (board/public view). */
export function rentalAvailableQty(item: RentalItem, bookings?: RentalBooking[]): number {
  const used = bookings ? rentalBookedQty(bookings, item.id) : (item.bookedQty ?? 0);
  return Math.max(0, (item.totalQty || 1) - used);
}
export function nextBookingNo(bookings: RentalBooking[]): string {
  let max = 0;
  for (const b of bookings) {
    const m = b.bookingNo?.match(/(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `R-${String(max + 1).padStart(4, "0")}`;
}
export function bookingRentBalance(b: RentalBooking): number {
  return Math.max(0, b.rentTotal - b.advancePaid - b.balancePaid);
}
export function isBookingOverdue(b: RentalBooking, today: string = todayKey()): boolean {
  return b.status === "out" && b.returnDate < today;
}
export interface RentalMoneyEvent { date: string; amount: number; kind: "advance" | "balance" | "fine" | "damage"; bookingId: string }
export function rentalMoneyEvents(b: RentalBooking): RentalMoneyEvent[] {
  if (b.status === "cancelled") return [];
  const ev: RentalMoneyEvent[] = [];
  if (b.advancePaid > 0) ev.push({ date: b.createdAt.slice(0, 10), amount: b.advancePaid, kind: "advance", bookingId: b.id });
  if (b.balancePaid > 0) ev.push({ date: (b.pickedUpAt ?? b.createdAt).slice(0, 10), amount: b.balancePaid, kind: "balance", bookingId: b.id });
  if (b.status === "completed") {
    const d = (b.actualReturnDate ?? b.returnedAt ?? b.createdAt).slice(0, 10);
    if ((b.lateFine ?? 0) > 0) ev.push({ date: d, amount: b.lateFine as number, kind: "fine", bookingId: b.id });
    if ((b.damageCharges ?? 0) > 0) ev.push({ date: d, amount: b.damageCharges as number, kind: "damage", bookingId: b.id });
  }
  return ev;
}
export function rentalIncomeOn(bookings: RentalBooking[], dateISO: string): number {
  return bookings.reduce((s, b) => s + rentalMoneyEvents(b).filter((e) => e.date === dateISO).reduce((x, e) => x + e.amount, 0), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// FACADE CORE — cache, shadow, hydration, realtime, write queue
// ─────────────────────────────────────────────────────────────────────────────
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const cache = {
  shop: { ...SHOP_DEFAULTS } as ShopSettings,
  menu: clone(SAMPLE_MENU) as MenuItem[],
  orders: [] as Order[],
  grocery: clone(SAMPLE_GROCERY) as GroceryItem[],
  heads: clone(GROCERY_HEADS_SEED) as GroceryHead[],
  subs: clone(GROCERY_SUBHEADS_SEED) as GrocerySubHead[],
  deals: clone(SAMPLE_DEALS) as Deal[],
  expenses: [] as Expense[],
  rentalItems: [] as RentalItem[],
  rentalBookings: [] as RentalBooking[],
  staffList: clone(STAFF_SEED) as StaffMember[],
  staffMember: null as StaffMember | null,
  entries: [] as StockEntry[],
  customer: null as CustomerAccount | null,
};
// Last-known SERVER state (DTO shapes) — saves diff against these.
const shadow = {
  menu: [] as MenuItem[],
  grocery: [] as GroceryItem[],
  heads: [] as GroceryHead[],
  subs: [] as GrocerySubHead[],
  deals: [] as Deal[],
  expenses: [] as Expense[],
  rentalItems: [] as RentalItem[],
  rentalBookings: [] as RentalBooking[],
  staffList: [] as StaffMember[],
  entries: [] as StockEntry[],
  orders: new Map<string, Order>(), // keyed by the CACHE (local) order id
};

function fire(name: string) {
  try { window.dispatchEvent(new Event(name)); } catch { /* ignore */ }
}
function fireOrders() {
  fire("canteen-orders-changed");
  try { const bc = new BroadcastChannel("canteen-pos-orders"); bc.postMessage("changed"); bc.close(); } catch { /* ignore */ }
}
function syncFail(what: string, e: unknown) {
  // eslint-disable-next-line no-console
  console.error(`[pos-sync] ${what} failed:`, e);
  try { window.dispatchEvent(new CustomEvent("pos-sync-error", { detail: { what, error: String(e) } })); } catch { /* ignore */ }
}

// Serialised write queue — catalogue/order saves never interleave.
let mq: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const p = mq.then(fn, fn);
  mq = p.then(() => undefined, () => undefined);
  return p;
}

// ── Tiny client prefs (sessionStorage): id aliases, idempotency keys,
// guest order access tokens. NOT business data. ──
function prefGet<T>(key: string): Record<string, T> {
  try { return JSON.parse(sessionStorage.getItem(key) ?? "{}") as Record<string, T>; } catch { return {}; }
}
function prefSet(key: string, map: Record<string, unknown>) {
  try { sessionStorage.setItem(key, JSON.stringify(map)); } catch { /* ignore */ }
}
function aliasGet(localId: string): string {
  return prefGet<string>("pos-id-alias")[localId] ?? localId;
}
function aliasSet(localId: string, serverId: string) {
  if (localId === serverId) return;
  const m = prefGet<string>("pos-id-alias");
  m[localId] = serverId;
  prefSet("pos-id-alias", m);
}
function clientRequestIdFor(localOrderId: string): string {
  const m = prefGet<string>("pos-req-ids");
  if (!m[localOrderId]) {
    m[localOrderId] = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    prefSet("pos-req-ids", m);
  }
  return m[localOrderId];
}
function storeGuestToken(serverOrderId: string, token: string) {
  const m = prefGet<string>("pos-guest-orders");
  m[serverOrderId] = token;
  prefSet("pos-guest-orders", m);
}

// ── Refreshers (each tolerates 401/403 — logged-out is a normal state) ──
async function refreshShop() {
  try {
    const r = await apiGet<{ settings: ShopSettings }>("/bootstrap");
    cache.shop = r.settings;
    fire("shop-updated");
  } catch { /* keep cache */ }
}
async function refreshCatalog() {
  try {
    const r = await apiGet<{ menu: MenuItem[]; heads: GroceryHead[]; subs: GrocerySubHead[]; items: GroceryItem[]; deals?: Deal[]; rentals?: RentalItem[] }>("/catalog");
    cache.menu = r.menu; shadow.menu = clone(r.menu);
    cache.heads = r.heads; shadow.heads = clone(r.heads);
    cache.subs = r.subs; shadow.subs = clone(r.subs);
    cache.grocery = r.items; shadow.grocery = clone(r.items);
    if (r.deals) { cache.deals = r.deals; shadow.deals = clone(r.deals); }
    if (r.rentals) { cache.rentalItems = r.rentals; shadow.rentalItems = clone(r.rentals); }
    fire("pos-catalog-changed");
  } catch { /* keep cache */ }
}
async function refreshExpenses() {
  try {
    const r = await apiGet<{ expenses: Expense[] }>("/owner/expenses");
    cache.expenses = r.expenses;
    shadow.expenses = clone(r.expenses);
    fire("expenses-changed");
  } catch { /* owner tab grant required — ignore */ }
}
async function refreshRentals() {
  try {
    const r = await apiGet<{ items: RentalItem[]; bookings: RentalBooking[] }>("/staff/rentals");
    cache.rentalItems = r.items;
    shadow.rentalItems = clone(r.items);
    cache.rentalBookings = r.bookings;
    shadow.rentalBookings = clone(r.bookings);
    fire("rentals-changed");
  } catch { /* rentals tab grant required — ignore */ }
}
async function refreshStaffList() {
  try {
    const r = await apiGet<{ staff: StaffMember[] }>("/auth/staff/list");
    cache.staffList = withOwnerGuard(r.staff);
    shadow.staffList = clone(r.staff);
    fire("staff-updated");
  } catch { /* keep cache */ }
}
async function refreshMe() {
  try {
    const r = await apiGet<{ member: StaffMember }>("/auth/staff/me");
    cache.staffMember = r.member;
    fire("staff-updated");
  } catch {
    if (cache.staffMember) { cache.staffMember = null; fire("staff-updated"); }
  }
}
function normalizeAccount(a: Partial<CustomerAccount> & { name: string; mobile: string }): CustomerAccount {
  return {
    name: a.name,
    mobile: a.mobile,
    password: "",
    email: a.email,
    emailVerified: a.emailVerified,
    mobileVerified: a.mobileVerified,
    placeType: (a.placeType ?? "Other") as CustomerAccount["placeType"],
    placeDetail: a.placeDetail ?? "",
    placeLabel: a.placeLabel,
    studentId: a.studentId,
    createdAt: a.createdAt ?? Date.now(),
  };
}
async function refreshCustomerMe() {
  try {
    const r = await apiGet<{ account: CustomerAccount }>("/auth/customer/me");
    cache.customer = normalizeAccount(r.account);
    fire("customer-updated");
  } catch {
    if (cache.customer) { cache.customer = null; fire("customer-updated"); }
  }
}
function withOwnerGuard(list: StaffMember[]): StaffMember[] {
  if (!Array.isArray(list) || list.length === 0) return clone(STAFF_SEED);
  if (!list.some((s) => s.isOwner && s.tabs.includes("owner"))) {
    return [...list, { ...STAFF_SEED[0], tabs: [...STAFF_SEED[0].tabs] }];
  }
  // Owner hamesha SAARE tabs rakhta hai — purani grant list mein naya tab
  // (rentals) missing ho to client par shamil kar do (server grants seed
  // se update hote hain; ye sirf display-side safety hai).
  return list.map((s) => (s.isOwner
    ? { ...s, tabs: Array.from(new Set<TabKey>([...s.tabs, ...TABS_META.map((t) => t.key)])) }
    : s));
}
function mergeServerOrders(list: Order[]) {
  for (const dto of list) {
    const existing = cache.orders.find((o) => o.serverId === dto.id || (o.clientRequestId && o.clientRequestId === dto.clientRequestId));
    if (existing) {
      const localId = existing.id;
      Object.assign(existing, dto, { id: localId, serverId: dto.id });
      shadow.orders.set(localId, clone(dto));
    } else {
      const entry: Order = { ...dto, serverId: dto.id };
      cache.orders.push(entry);
      shadow.orders.set(dto.id, clone(dto));
    }
  }
  cache.orders.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  fireOrders();
}
async function refreshOrders() {
  if (cache.staffMember || cache.customer) {
    try {
      const r = await apiGet<{ orders: Order[] }>("/orders");
      mergeServerOrders(r.orders);
      return;
    } catch { /* fall through to guest refresh */ }
  }
  // Guest / table orders placed from THIS browser: poll their public status.
  const tokens = prefGet<string>("pos-guest-orders");
  const ids = Object.keys(tokens);
  if (!ids.length) return;
  let changed = false;
  for (const serverId of ids) {
    try {
      const r = await apiGet<{ order: { status: string; token: number; paymentStatus?: OrderPaymentStatus; rejectReason?: string; billNo?: string } }>(
        `/public/orders/${serverId}/status?token=${encodeURIComponent(tokens[serverId])}`
      );
      const entry = cache.orders.find((o) => o.serverId === serverId);
      if (entry) {
        const before = JSON.stringify([entry.status, entry.token, entry.paymentStatus]);
        entry.status = r.order.status as Order["status"];
        entry.token = r.order.token;
        if (r.order.paymentStatus !== undefined) entry.paymentStatus = r.order.paymentStatus;
        if (r.order.rejectReason !== undefined) entry.rejectReason = r.order.rejectReason;
        if (r.order.billNo) entry.billNo = r.order.billNo;
        const sh = shadow.orders.get(entry.id);
        if (sh) { sh.status = entry.status; sh.token = entry.token; sh.paymentStatus = entry.paymentStatus; }
        if (before !== JSON.stringify([entry.status, entry.token, entry.paymentStatus])) changed = true;
      }
    } catch { /* token stale — ignore */ }
  }
  if (changed) fireOrders();
}
async function refreshEntries() {
  try {
    const r = await apiGet<{ entries: StockEntry[] }>("/staff/stock-entries?limit=500");
    cache.entries = r.entries;
    shadow.entries = clone(r.entries);
    fire("pos-entries-changed");
  } catch { /* stock tab grant required — ignore */ }
}

let started = false;
let es: EventSource | null = null;
function handleRealtime(type: string) {
  if (type.startsWith("order.") || type.startsWith("dashboard.") || type.startsWith("table_session.")) void refreshOrders();
  if (type.startsWith("catalog.") || type.startsWith("stock.")) { void refreshCatalog(); void refreshEntries(); }
  if (type === "settings.changed") void refreshShop();
  if (type === "staff.changed") { void refreshStaffList(); void refreshMe(); }
  if (type.startsWith("rentals.")) void refreshRentals();
}
function ensureStarted() {
  if (started || typeof window === "undefined") return;
  started = true;
  void (async () => {
    await refreshShop();
    await refreshCatalog();
    await refreshStaffList();
    await refreshMe();
    await refreshCustomerMe();
    await refreshOrders();
    await refreshEntries();
    await refreshExpenses();
    await refreshRentals();
  })();
  // Realtime: SSE (snapshot already loaded via REST above). The browser
  // auto-reconnects with Last-Event-ID; the server replays missed events.
  try {
    es = new EventSource("/api/v1/events");
    es.onmessage = (ev) => {
      try { handleRealtime((JSON.parse(ev.data) as { type: string }).type); } catch { /* heartbeat */ }
    };
  } catch { /* polling fallback below still runs */ }
  // Polling fallback (plan: 15–30s; 5s here keeps the kitchen snappy even
  // if a proxy kills the SSE stream).
  setInterval(() => { if (!document.hidden) void refreshOrders(); }, 5000);
  setInterval(() => { if (!document.hidden) { void refreshCatalog(); void refreshEntries(); } }, 30000);
}

// ── SHOP SETTINGS ───────────────────────────────────────────────────────────
export function loadShop(): ShopSettings {
  ensureStarted();
  return cache.shop;
}
export function useShop(): ShopSettings {
  const [s, setS] = useState<ShopSettings>(() => cache.shop);
  useEffect(() => {
    ensureStarted();
    const read = () => setS({ ...cache.shop });
    read();
    window.addEventListener("shop-updated", read);
    const t = setInterval(read, 3000);
    return () => { window.removeEventListener("shop-updated", read); clearInterval(t); };
  }, []);
  return s;
}
export function saveShop(nextSettings: ShopSettings): void {
  cache.shop = { ...nextSettings };
  fire("shop-updated");
  void enqueue(async () => {
    try {
      const r = await apiPatch<{ settings: ShopSettings }>("/owner/settings", nextSettings);
      cache.shop = r.settings;
      fire("shop-updated");
    } catch (e) { syncFail("settings save", e); }
  });
}

// ── CUSTOMER ACCOUNTS (server-backed) ───────────────────────────────────────
// The Phase 1 signatures were synchronous over localStorage; Phase 2 makes
// register/login async (they hit the API). The online page awaits them.
export function loadAccounts(): CustomerAccount[] {
  // Accounts are server records now — a client-side list is never exposed.
  return [];
}
export interface DeliveryState { delivered: boolean; state: "sent" | "NOT_CONFIGURED" | "FAILED"; detail?: string }
export interface RegisterResult {
  status: "ok" | "exists";
  // Pehle email code ki delivery halat — UI honestly dikhati hai ke code
  // gaya ya deployment par email configure hone par jayega.
  emailDelivery?: DeliveryState;
}

export async function registerAccount(a: Omit<CustomerAccount, "createdAt">): Promise<RegisterResult> {
  ensureStarted();
  try {
    const r = await apiPost<{ account: CustomerAccount; verification?: { emailDelivery: DeliveryState } }>("/auth/customer/register", {
      name: a.name, mobile: a.mobile, password: a.password, email: a.email,
      placeType: a.placeType, placeDetail: a.placeDetail, studentId: a.studentId,
    });
    cache.customer = normalizeAccount(r.account);
    fire("customer-updated");
    void refreshOrders();
    return { status: "ok", emailDelivery: r.verification?.emailDelivery };
  } catch (e) {
    if ((e as { code?: string }).code === "ACCOUNT_EXISTS" || (e as { code?: string }).code === "MOBILE_EXISTS") return { status: "exists" };
    throw e;
  }
}

// ── Account verification (email lazmi, mobile ikhtiyari) ────────────────────
// Teeno functions server ki ASAL halat wapas karte hain — ghalat code par
// error throw hota hai (message UI ko dikhta hai), resend par delivery
// state (NOT_CONFIGURED समेत) wapas ati hai.
/**
 * Pehla Business Setup (fresh install, login se pehle) — server ka
 * /setup/complete endpoint sirf setup_done=false par khula hota hai;
 * us ke baad ye hamesha 403 dega aur tabdeeli Owner Settings se hogi.
 * Change-mode (setup pehle ho chuka) ke liye saveShop() hi sahi rasta hai.
 */
export async function completeFirstSetup(next: ShopSettings): Promise<void> {
  const r = await apiPost<{ settings: ShopSettings }>("/setup/complete", {
    hasCanteen: next.hasCanteen, retailType: next.retailType, groceryName: next.groceryName,
  });
  cache.shop = r.settings;
  fire("shop-updated");
  // Template seed server par hua ho to catalogue bhi naya hoga.
  await refreshCatalog();
}

export async function verifyEmailCode(code: string): Promise<void> {
  await apiPost("/auth/customer/verify-email", { code });
  await refreshCustomerMe();
}
export async function verifyMobileCode(code: string): Promise<void> {
  await apiPost("/auth/customer/verify-mobile", { code });
  await refreshCustomerMe();
}
export async function resendVerificationCode(channel: "email" | "mobile"): Promise<DeliveryState> {
  const r = await apiPost<{ delivery: DeliveryState }>("/auth/customer/resend-code", { channel });
  return r.delivery;
}
export async function loginAccount(mobile: string, password: string): Promise<CustomerAccount | null> {
  ensureStarted();
  try {
    const r = await apiPost<{ account: CustomerAccount }>("/auth/customer/login", { mobile, password });
    cache.customer = normalizeAccount(r.account);
    fire("customer-updated");
    void refreshOrders();
    return cache.customer;
  } catch { return null; }
}
export function setSession(mobile: string | null) {
  if (mobile === null) {
    cache.customer = null;
    fire("customer-updated");
    void apiPost("/auth/customer/logout").catch(() => undefined);
  }
  // Non-null: login/register already established the server session.
}
export function getSessionAccount(): CustomerAccount | null {
  ensureStarted();
  return cache.customer;
}

// ── MENU ────────────────────────────────────────────────────────────────────
export function loadMenu(): MenuItem[] {
  ensureStarted();
  return [...cache.menu];
}
function menuPayload(m: MenuItem) {
  return {
    name: m.name, price: m.price, category: m.category, emoji: m.emoji,
    image: m.image ?? null, images: itemPhotos(m), sku: m.sku ?? null, lowStock: m.lowStock ?? 5,
    cost: m.cost ?? null, // Lagat (P&L) — null = nahi bhari
    // NOTE: stock is deliberately NOT sent — stock moves only through
    // orders / stock entries / payment transitions (exactly-once rule).
  };
}
function menuChanged(a: MenuItem, b: MenuItem): boolean {
  return a.name !== b.name || a.price !== b.price || a.category !== b.category || a.emoji !== b.emoji
    || (a.image ?? "") !== (b.image ?? "") || JSON.stringify(itemPhotos(a)) !== JSON.stringify(itemPhotos(b))
    || (a.sku ?? "") !== (b.sku ?? "") || (a.lowStock ?? 5) !== (b.lowStock ?? 5)
    || (a.cost ?? null) !== (b.cost ?? null);
}
export function saveMenu(menu: MenuItem[]): void {
  cache.menu = [...menu];
  void enqueue(async () => {
    try {
      const shById = new Map(shadow.menu.map((m) => [m.id, m]));
      const seen = new Set<string>();
      for (const it of menu) {
        const sid = aliasGet(it.id);
        seen.add(sid);
        const sh = shById.get(sid);
        if (!sh) {
          const r = await apiPost<{ id: string }>("/owner/canteen/items", menuPayload(it));
          aliasSet(it.id, r.id);
        } else if (menuChanged(sh, it)) {
          await apiPatch(`/owner/canteen/items/${sid}`, menuPayload(it));
        }
      }
      for (const sh of shadow.menu) {
        if (!seen.has(sh.id)) await apiDelete(`/owner/canteen/items/${sh.id}`).catch(() => undefined);
      }
      await refreshCatalog();
    } catch (e) { syncFail("menu save", e); }
  });
}

// ── ORDERS ──────────────────────────────────────────────────────────────────
export function loadOrders(): Order[] {
  ensureStarted();
  return [...cache.orders];
}
function parseLineName(o: Order, l: OrderLine): { variantName?: string; packingLabel?: string } {
  if (o.mode !== "grocery" || !l.name.includes("(")) return {};
  const item = cache.grocery.find((g) => g.id === l.itemId);
  if (!item || l.name === item.name) return {};
  const m = l.name.match(/\(([^()]*)\)\s*$/);
  const inner = m?.[1]?.trim();
  if (!inner || inner === "kg") return {};
  if (inner.includes(" · ")) {
    const [v, p] = inner.split(" · ").map((s) => s.trim());
    return { variantName: v, packingLabel: p };
  }
  return { packingLabel: inner };
}
function toCreateInput(o: Order) {
  return {
    clientRequestId: clientRequestIdFor(o.id),
    shopKind: o.mode === "grocery" ? "grocery" : "canteen",
    priceType: o.priceType ?? "retail",
    lines: o.lines.map((l) => ({
      itemId: l.itemId.startsWith("deal:") ? `deal:${aliasGet(l.itemId.slice("deal:".length))}` : aliasGet(l.itemId),
      qty: l.qty,
      ...(l.serials?.length ? { serials: l.serials } : {}),
      ...parseLineName(o, l),
    })),
    discount: o.discount ?? 0,
    payment: o.payment,
    tendered: o.tendered,
    udhaarName: o.udhaarName,
    identityType: o.identityType,
    customerName: o.customerName,
    customerMobile: o.customerMobile,
    customerExternalId: o.customerId,
    placeLabel: o.placeLabel,
    orderType: o.orderType,
    tableNo: o.tableNo,
    paymentProof: o.paymentProof
      ? { method: o.paymentProof.method, txnId: o.paymentProof.txnId, amount: o.paymentProof.amount, proofImage: o.paymentProof.proofImage }
      : undefined,
  };
}
export function saveOrders(nextOrders: Order[]): void {
  cache.orders = [...nextOrders];
  fireOrders();
  void enqueue(async () => {
    // Creates (idempotency: the same clientRequestId never double-posts).
    for (const o of nextOrders) {
      if (shadow.orders.has(o.id)) continue;
      try {
        const input = toCreateInput(o);
        const res = await apiPost<{ order: Order; accessToken?: string }>("/orders", input);
        const dto = res.order;
        o.serverId = dto.id;
        o.clientRequestId = input.clientRequestId;
        o.billNo = dto.billNo;
        o.token = dto.token;
        o.total = dto.total;
        o.subtotal = dto.subtotal;
        o.discount = dto.discount;
        if (res.accessToken) storeGuestToken(dto.id, res.accessToken);
        shadow.orders.set(o.id, clone(dto));
      } catch (e) { syncFail("order create", e); }
    }
    // Updates: kitchen status + payment-proof transitions.
    for (const o of nextOrders) {
      const sh = shadow.orders.get(o.id);
      if (!sh || !o.serverId) continue;
      try {
        if (o.status !== sh.status) {
          const r = await apiPatch<{ order: Order }>(`/orders/${o.serverId}/status`, { status: o.status });
          shadow.orders.set(o.id, clone(r.order));
          o.token = r.order.token;
          sh.status = o.status;
        }
        if ((o.paymentStatus ?? null) !== (sh.paymentStatus ?? null)) {
          if (o.paymentStatus === "confirmed") {
            const r = await apiPost<{ order: Order }>(`/orders/${o.serverId}/payment`, { action: "confirm" });
            shadow.orders.set(o.id, clone(r.order));
            o.token = r.order.token;
          } else if (o.paymentStatus === "rejected") {
            const r = await apiPost<{ order: Order }>(`/orders/${o.serverId}/payment`, { action: "reject", reason: o.rejectReason ?? "" });
            shadow.orders.set(o.id, clone(r.order));
          } else if (o.paymentStatus === "proof_pending" && sh.paymentStatus === "rejected") {
            const r = await apiPost<{ order: Order }>(`/orders/${o.serverId}/payment`, { action: "reproof", proof: o.paymentProof });
            shadow.orders.set(o.id, clone(r.order));
          }
          const cur = shadow.orders.get(o.id);
          if (cur) sh.paymentStatus = cur.paymentStatus;
        }
      } catch (e) { syncFail("order update", e); }
    }
    fireOrders();
  });
}

/**
 * Move an order's stock visually in the local cache (dir -1 deducts, +1
 * restores). Phase 2: the SERVER moves real stock inside the order/payment
 * transactions — this only keeps the on-screen numbers in step until the
 * next catalogue refresh lands (catalogue saves never write stock).
 */
export function adjustStockForOrder(order: Order, dir: 1 | -1): void {
  if (typeof window === "undefined") return;
  const per = new Map<string, number>();
  order.lines.forEach((l) => {
    // Deal line ka stock us ke asal items se katta/wapas hota hai —
    // components snapshot ko expand karein (Phase 1 semantics).
    if (l.components?.length) {
      l.components.forEach((c) => per.set(c.itemId, (per.get(c.itemId) ?? 0) + c.qty * l.qty));
    } else {
      per.set(l.itemId, (per.get(l.itemId) ?? 0) + l.qty);
    }
  });
  if (!per.size) return;
  if (order.mode === "grocery") {
    cache.grocery = cache.grocery.map((it) => {
      const q = per.get(it.id);
      return q ? { ...it, stock: Math.max(0, Math.round((it.stock + dir * q) * 10) / 10) } : it;
    });
  } else {
    cache.menu = cache.menu.map((m) => {
      const q = per.get(m.id);
      return q ? { ...m, stock: Math.max(0, (m.stock ?? 0) + dir * q) } : m;
    });
  }
  fire("pos-catalog-changed");
}

// ── GROCERY CATALOGUE ───────────────────────────────────────────────────────
export function loadGroceryHeads(): GroceryHead[] {
  ensureStarted();
  return [...cache.heads];
}
export function saveGroceryHeads(list: GroceryHead[]): void {
  cache.heads = [...list];
  void enqueue(async () => {
    try {
      const shById = new Map(shadow.heads.map((h) => [h.id, h]));
      const seen = new Set<string>();
      for (const h of list) {
        const sid = aliasGet(h.id);
        seen.add(sid);
        const sh = shById.get(sid);
        const payload = { name: h.name, emoji: h.emoji, image: h.image ?? null };
        if (!sh) {
          const r = await apiPost<{ id: string }>("/owner/grocery/heads", payload);
          aliasSet(h.id, r.id);
        } else if (sh.name !== h.name || sh.emoji !== h.emoji || (sh.image ?? "") !== (h.image ?? "")) {
          await apiPatch(`/owner/grocery/heads/${sid}`, payload);
        }
      }
      for (const sh of shadow.heads) {
        if (!seen.has(sh.id)) await apiDelete(`/owner/grocery/heads/${sh.id}`).catch(() => undefined);
      }
      await refreshCatalog();
    } catch (e) { syncFail("heads save", e); }
  });
}
export function loadGrocerySubHeads(): GrocerySubHead[] {
  ensureStarted();
  return [...cache.subs];
}
export function saveGrocerySubHeads(list: GrocerySubHead[]): void {
  cache.subs = [...list];
  void enqueue(async () => {
    try {
      const shById = new Map(shadow.subs.map((s) => [s.id, s]));
      const seen = new Set<string>();
      for (const s of list) {
        const sid = aliasGet(s.id);
        seen.add(sid);
        const sh = shById.get(sid);
        const payload = { headId: aliasGet(s.headId), name: s.name, image: s.image ?? null };
        if (!sh) {
          const r = await apiPost<{ id: string }>("/owner/grocery/sub-heads", payload);
          aliasSet(s.id, r.id);
        } else if (sh.name !== s.name || sh.headId !== aliasGet(s.headId) || (sh.image ?? "") !== (s.image ?? "")) {
          await apiPatch(`/owner/grocery/sub-heads/${sid}`, payload);
        }
      }
      for (const sh of shadow.subs) {
        if (!seen.has(sh.id)) await apiDelete(`/owner/grocery/sub-heads/${sh.id}`).catch(() => undefined);
      }
      await refreshCatalog();
    } catch (e) { syncFail("sub-heads save", e); }
  });
}
export function loadGrocery(): GroceryItem[] {
  ensureStarted();
  return [...cache.grocery];
}
function productPayload(it: GroceryItem) {
  return {
    name: it.name,
    brand: it.brand ?? undefined,
    subId: aliasGet(it.subId),
    sku: it.sku,
    barcode: it.barcode ?? null,
    retailPrice: it.retailPrice,
    wholesalePrice: it.wholesalePrice,
    wholesaleMinQty: it.wholesaleMinQty ?? null,
    unit: it.unit,
    lowStock: it.lowStock ?? (it.unit === "kg" ? 2 : 5),
    boardOffer: it.boardOffer ?? false,
    offerPrice: it.offerPrice && it.offerPrice > 0 ? it.offerPrice : null,
    trackSerial: it.trackSerial ?? false,
    emoji: it.emoji,
    image: it.image ?? null,
    images: itemPhotos(it),
    // Packings of the Standard variant (label, prices, own barcode,
    // containsQty sealed packs, per-packing wholesale minimum).
    packings: (it.packings ?? []).map((k) => ({
      label: k.label,
      retailPrice: k.retailPrice,
      wholesalePrice: k.wholesalePrice,
      barcode: k.barcode ?? null,
      containsQty: k.containsQty,
      wholesaleMinQty: k.wholesaleMinQty,
    })),
    // NOTE: stock intentionally NOT sent (exactly-once stock rule).
  };
}
function productChanged(a: GroceryItem, b: GroceryItem): boolean {
  const proj = (x: GroceryItem) => JSON.stringify({
    name: x.name, brand: x.brand ?? null, subId: x.subId, sku: x.sku, barcode: x.barcode ?? null,
    retailPrice: x.retailPrice, wholesalePrice: x.wholesalePrice, wholesaleMinQty: x.wholesaleMinQty ?? null,
    unit: x.unit, lowStock: x.lowStock ?? null, boardOffer: x.boardOffer ?? false, offerPrice: x.offerPrice ?? null, trackSerial: x.trackSerial ?? false, emoji: x.emoji, image: x.image ?? null, images: itemPhotos(x),
    packings: (x.packings ?? []).map((k) => [k.label, k.retailPrice, k.wholesalePrice, k.barcode ?? null, k.containsQty ?? null, k.wholesaleMinQty ?? null]),
  });
  return proj(a) !== proj(b);
}
export function saveGrocery(items: GroceryItem[]): void {
  cache.grocery = [...items];
  void enqueue(async () => {
    try {
      const shById = new Map(shadow.grocery.map((g) => [g.id, g]));
      const seen = new Set<string>();
      for (const it of items) {
        const sid = aliasGet(it.id);
        seen.add(sid);
        const sh = shById.get(sid);
        if (!sh) {
          const r = await apiPost<{ id: string }>("/owner/grocery/products", productPayload(it));
          aliasSet(it.id, r.id);
        } else if (productChanged({ ...sh, subId: it.subId }, it)) {
          await apiPatch(`/owner/grocery/products/${sid}`, productPayload(it));
        }
      }
      for (const sh of shadow.grocery) {
        if (!seen.has(sh.id)) await apiDelete(`/owner/grocery/products/${sh.id}`).catch(() => undefined);
      }
      await refreshCatalog();
    } catch (e) { syncFail("grocery save", e); }
  });
}

// ── STAFF ───────────────────────────────────────────────────────────────────
export function loadStaff(): StaffMember[] {
  ensureStarted();
  return withOwnerGuard([...cache.staffList]);
}
export function saveStaff(list: StaffMember[]): void {
  cache.staffList = withOwnerGuard([...list]);
  fire("staff-updated");
  void enqueue(async () => {
    try {
      const shById = new Map(shadow.staffList.map((s) => [s.id, s]));
      const seen = new Set<string>();
      for (const m of list) {
        seen.add(m.id);
        const sh = shById.get(m.id);
        if (!sh) {
          await apiPost("/owner/staff", { name: m.name, pin: m.pin || "0000", tabs: m.tabs });
        } else {
          const patch: { name?: string; pin?: string } = {};
          if (sh.name !== m.name) patch.name = m.name;
          if (m.pin) patch.pin = m.pin; // a PIN is only sent when the owner typed a new one
          if (Object.keys(patch).length) await apiPatch(`/owner/staff/${m.id}`, patch);
          const tabsChanged = JSON.stringify([...sh.tabs].sort()) !== JSON.stringify([...m.tabs].sort());
          if (tabsChanged) await apiPut(`/owner/staff/${m.id}/grants`, { tabs: m.tabs });
        }
      }
      for (const sh of shadow.staffList) {
        if (!seen.has(sh.id) && !sh.isOwner) await apiDelete(`/owner/staff/${sh.id}`).catch(() => undefined);
      }
      await refreshStaffList();
      await refreshMe();
    } catch (e) { syncFail("staff save", e); }
  });
}
/** Real staff login — verifies the PIN on the server (Phase 2). */
export async function staffLogin(memberId: string, pin: string): Promise<StaffMember | null> {
  ensureStarted();
  try {
    const r = await apiPost<{ member: StaffMember }>("/auth/staff/login", { staffId: memberId, pin });
    cache.staffMember = r.member;
    fire("staff-updated");
    void refreshOrders();
    void refreshEntries();
    return r.member;
  } catch { return null; }
}
export function setStaffSession(id: string | null) {
  if (id === null) {
    cache.staffMember = null;
    fire("staff-updated");
    void apiPost("/auth/staff/logout").catch(() => undefined);
  }
  // Non-null sessions are established by staffLogin() (server-verified).
}
export function getStaffSessionMember(): StaffMember | null {
  ensureStarted();
  return cache.staffMember;
}
export function useStaffSession(): StaffMember | null {
  const [m, setM] = useState<StaffMember | null>(() => cache.staffMember);
  useEffect(() => {
    ensureStarted();
    const read = () => setM(cache.staffMember ? { ...cache.staffMember } : null);
    read();
    window.addEventListener("staff-updated", read);
    const t = setInterval(read, 3000);
    return () => { window.removeEventListener("staff-updated", read); clearInterval(t); };
  }, []);
  return m;
}

// ── STOCK ENTRIES ───────────────────────────────────────────────────────────
export function loadStockEntries(): StockEntry[] {
  ensureStarted();
  return [...cache.entries];
}
export function saveStockEntries(entries: StockEntry[]): void {
  cache.entries = [...entries];
  void enqueue(async () => {
    try {
      const shIds = new Set(shadow.entries.map((e) => e.id));
      for (const e of entries) {
        if (shIds.has(e.id)) continue;
        const r = await apiPost<{ entry: StockEntry }>("/staff/stock-entries", {
          kind: e.kind, itemId: aliasGet(e.itemId), type: e.type, qty: e.qty,
          rate: e.rate, supplier: e.supplier, reason: e.reason, expiry: e.expiry,
        });
        e.serverId = r.entry.id;
      }
      await refreshEntries();
      await refreshCatalog();
    } catch (err) { syncFail("stock entries save", err); }
  });
}

// ── DEALS ───────────────────────────────────────────────────────────────────
export function loadDeals(): Deal[] {
  ensureStarted();
  return [...cache.deals];
}
function dealPayload(d: Deal) {
  return {
    name: d.name, price: d.price, active: d.active,
    items: d.items.map((i) => ({ menuItemId: aliasGet(i.menuItemId), qty: i.qty })),
  };
}
function dealChanged(a: Deal, b: Deal): boolean {
  return a.name !== b.name || a.price !== b.price || a.active !== b.active
    || JSON.stringify(a.items) !== JSON.stringify(b.items);
}
export function saveDeals(deals: Deal[]): void {
  cache.deals = [...deals];
  fire("pos-catalog-changed");
  void enqueue(async () => {
    try {
      const shById = new Map(shadow.deals.map((d) => [d.id, d]));
      const seen = new Set<string>();
      for (const d of deals) {
        const sid = aliasGet(d.id);
        seen.add(sid);
        const sh = shById.get(sid);
        if (!sh) {
          const r = await apiPost<{ deal: Deal }>("/owner/deals", dealPayload(d));
          if (r.deal?.id) aliasSet(d.id, r.deal.id);
        } else if (dealChanged(sh, d)) {
          await apiPatch(`/owner/deals/${sid}`, dealPayload(d));
        }
      }
      for (const sh of shadow.deals) {
        if (!seen.has(sh.id)) await apiDelete(`/owner/deals/${sh.id}`).catch(() => undefined);
      }
      await refreshCatalog();
    } catch (e) { syncFail("deals save", e); }
  });
}

// ── EXPENSES ────────────────────────────────────────────────────────────────
export function loadExpenses(): Expense[] {
  ensureStarted();
  return [...cache.expenses];
}
export function saveExpenses(expenses: Expense[]): void {
  cache.expenses = [...expenses];
  fire("expenses-changed");
  void enqueue(async () => {
    try {
      const shById = new Map(shadow.expenses.map((e) => [e.id, e]));
      const seen = new Set<string>();
      for (const e of expenses) {
        const sid = aliasGet(e.id);
        seen.add(sid);
        const sh = shById.get(sid);
        const payload = { dateISO: e.dateISO, title: e.title, amount: e.amount, shop: e.shop, note: e.note };
        if (!sh) {
          const r = await apiPost<{ expense: Expense }>("/owner/expenses", payload);
          if (r.expense?.id) aliasSet(e.id, r.expense.id);
        } else if (sh.dateISO !== e.dateISO || sh.title !== e.title || sh.amount !== e.amount || sh.shop !== e.shop || (sh.note ?? "") !== (e.note ?? "")) {
          await apiPatch(`/owner/expenses/${sid}`, payload);
        }
      }
      for (const sh of shadow.expenses) {
        if (!seen.has(sh.id)) await apiDelete(`/owner/expenses/${sh.id}`).catch(() => undefined);
      }
      await refreshExpenses();
    } catch (e) { syncFail("expenses save", e); }
  });
}

// ── KIRAYA / RENTALS — server-backed (staff bookings + owner items) ─────────
// Items ka CRUD OWNER routes se hota hai (sirf owner dress add/edit kar
// sakta hai); bookings STAFF routes se (rentals tab wale staff). Booking
// save par server usi transaction mein dress ki status bhi sync karta
// hai (booked → out → available/cleaning), is liye items ka alag save
// sirf owner ki direct tabdeeli (rate/status waghera) ke liye hai.
export function loadRentalItems(): RentalItem[] {
  ensureStarted();
  return [...cache.rentalItems];
}
export function loadRentalBookings(): RentalBooking[] {
  ensureStarted();
  return [...cache.rentalBookings];
}

const rentalItemPayload = (i: RentalItem) => ({
  name: i.name, category: i.category, totalQty: i.totalQty, size: i.size, color: i.color, rentPerDay: i.rentPerDay,
  securityDeposit: i.securityDeposit, emoji: i.emoji, image: i.image, images: i.images,
  offerRentPerDay: i.offerRentPerDay, boardOffer: i.boardOffer, status: i.status,
});
const rentalBookingPayload = (b: RentalBooking) => ({
  itemId: b.itemId, itemName: b.itemName, qty: b.qty || 1, customerName: b.customerName,
  customerMobile: b.customerMobile, customerCnic: b.customerCnic,
  pickupDate: b.pickupDate, returnDate: b.returnDate, days: b.days,
  rentPerDay: b.rentPerDay, listRentPerDay: b.listRentPerDay, rentTotal: b.rentTotal,
  securityDeposit: b.securityDeposit, securityKind: b.securityKind,
  advancePaid: b.advancePaid, balancePaid: b.balancePaid, status: b.status,
  pickedUpAt: b.pickedUpAt, returnedAt: b.returnedAt, actualReturnDate: b.actualReturnDate,
  lateDays: b.lateDays, lateFinePerDay: b.lateFinePerDay, lateFine: b.lateFine,
  damageCharges: b.damageCharges, damageNote: b.damageNote, returnCondition: b.returnCondition,
  securityDeducted: b.securityDeducted, securityRefunded: b.securityRefunded, extraDue: b.extraDue,
});

export function saveRentalItems(items: RentalItem[]): void {
  cache.rentalItems = [...items];
  fire("rentals-changed");
  void enqueue(async () => {
    try {
      const shById = new Map(shadow.rentalItems.map((i) => [i.id, i]));
      const seen = new Set<string>();
      for (const it of items) {
        const sid = aliasGet(it.id);
        seen.add(sid);
        const sh = shById.get(sid);
        if (!sh) {
          const r = await apiPost<{ item: RentalItem }>("/owner/rental-items", { id: it.id, ...rentalItemPayload(it) });
          if (r.item?.id) aliasSet(it.id, r.item.id);
        } else if (JSON.stringify(rentalItemPayload(sh)) !== JSON.stringify(rentalItemPayload(it))) {
          await apiPatch(`/owner/rental-items/${sid}`, rentalItemPayload(it));
        }
      }
      for (const sh of shadow.rentalItems) {
        if (!seen.has(sh.id)) await apiDelete(`/owner/rental-items/${sh.id}`).catch(() => undefined);
      }
      await refreshRentals();
    } catch (e) { syncFail("rental items save", e); }
  });
}

export function saveRentalBookings(bookings: RentalBooking[]): void {
  cache.rentalBookings = [...bookings];
  fire("rentals-changed");
  void enqueue(async () => {
    try {
      const shById = new Map(shadow.rentalBookings.map((b) => [b.id, b]));
      const seen = new Set<string>();
      for (const b of bookings) {
        const sid = aliasGet(b.id);
        seen.add(sid);
        const sh = shById.get(sid);
        if (!sh) {
          const r = await apiPost<{ booking: RentalBooking }>("/staff/rentals/bookings", { id: b.id, ...rentalBookingPayload(b) });
          if (r.booking?.id) aliasSet(b.id, r.booking.id);
        } else if (JSON.stringify(rentalBookingPayload(sh)) !== JSON.stringify(rentalBookingPayload(b))) {
          await apiPatch(`/staff/rentals/bookings/${sid}`, rentalBookingPayload(b));
        }
      }
      for (const sh of shadow.rentalBookings) {
        if (!seen.has(sh.id)) await apiDelete(`/staff/rentals/bookings/${sh.id}`).catch(() => undefined);
      }
      await refreshRentals();
    } catch (e) { syncFail("rental bookings save", e); }
  });
}
