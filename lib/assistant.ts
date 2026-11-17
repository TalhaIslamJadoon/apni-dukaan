// ─────────────────────────────────────────────────────────────────────────────
// AI ASSISTANT — deterministic local query engine (Phase 1).
//
// NOT a fake LLM: every answer is computed from the app's REAL local data
// (products, stock, bills, orders, stock entries in lib/store.ts) by
// pattern-matched intents in Roman Urdu + English mix. Role-aware:
//   owner    — full access (sales, wholesale, profit-side info, udhaar)
//   staff    — canteen/grocery counters: product finder, packings, pending
//              orders for their area, how-to. NO wholesale / profit / udhaar.
//   stock    — stock keeper: low / out-of-stock, recent entries, worst head
//   kitchen  — pending tokens, oldest pending, dine-in vs takeaway
//   customer — online shoppers: catalogue search, budget picks, OWN order
//              status only. No internal data at all.
// The panel footer says this honestly; a real AI (Gemini) is Phase 2.
// ─────────────────────────────────────────────────────────────────────────────

import {
  GroceryItem, Order, PackingOption,
  loadGrocery, loadGroceryHeads, loadGrocerySubHeads, loadMenu, loadOrders, loadStockEntries, isToday, billNoOf, isPaymentCleared, loadShop, hasRetail,
} from "./store";

// Offer pricing — LOCAL copies of the lib/store.ts helpers. This module is
// imported by the server route /api/v1/assistant/query, and lib/store.ts is
// a client module: calling its functions from the server throws. The rules
// are pure functions of the item shape, so they are mirrored here (keep in
// sync with offerActive/effectiveRetail/effectivePackingRetail in store.ts
// and the charging rule in server/services/orders.ts).
function offerActive(g: GroceryItem): boolean {
  return g.boardOffer === true
    && typeof g.offerPrice === "number" && g.offerPrice > 0
    && g.offerPrice < g.retailPrice;
}
function effectiveRetail(g: GroceryItem): number {
  return offerActive(g) ? (g.offerPrice as number) : g.retailPrice;
}
function effectivePackingRetail(g: GroceryItem, p: PackingOption): number {
  if (!offerActive(g) || !g.packings) return p.retailPrice;
  const op = g.packings.find((x) => x.retailPrice === g.retailPrice);
  return op && op.label === p.label ? (g.offerPrice as number) : p.retailPrice;
}

export type Audience = "owner" | "staff" | "stock" | "kitchen" | "customer";

export interface AssistantCtx {
  audience: Audience;
  memberName?: string;
  staffTabs?: string[]; // staff member's tab grants — scopes shop-only answers
  customerMobile?: string;
  customerName?: string;
}

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString()}`;
const gLowAt = (g: GroceryItem) => g.lowStock ?? (g.unit === "kg" ? 2 : 5);
const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function snap() {
  return {
    grocery: loadGrocery(), heads: loadGroceryHeads(), subs: loadGrocerySubHeads(),
    menu: loadMenu(), orders: loadOrders(), entries: loadStockEntries(),
  };
}
export type Snap = ReturnType<typeof snap>;

const headName = (s: Snap, g: GroceryItem) => s.heads.find((h) => h.id === g.headId)?.name ?? "";
const subName = (s: Snap, g: GroceryItem) => s.subs.find((x) => x.id === g.subId)?.name ?? "";

function findProducts(s: Snap, q: string): GroceryItem[] {
  const tokens = q.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  const scored = s.grocery.map((g) => {
    const name = g.name.toLowerCase();
    let score = 0;
    for (const t of tokens) if (name.includes(t)) score += 2;
    if (name.includes(q.toLowerCase().trim())) score += 5;
    return { g, score };
  }).filter((x) => x.score > 0);
  return scored.sort((a, b) => b.score - a.score).slice(0, 5).map((x) => x.g);
}
function findMenu(s: Snap, q: string) {
  const tokens = q.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  return s.menu.filter((m) => tokens.some((t) => m.name.toLowerCase().includes(t))).slice(0, 5);
}

function productAnswer(s: Snap, g: GroceryItem, audience: Audience): string {
  const lines = [`${g.emoji} ${g.name} — ${headName(s, g)} › ${subName(s, g)}`];
  // Offer-aware (Phase 2 port): when an offer price is ACTIVE the assistant
  // quotes the price the customer actually pays, with the purana rate named.
  const onOffer = offerActive(g);
  const offerNote = onOffer ? ` 🎉 Offer chal raha hai (purana rate ${rs(g.retailPrice)})` : "";
  if (audience === "customer") {
    lines.push(g.packings?.length
      ? `Price: ${rs(Math.min(...g.packings.map((p) => effectivePackingRetail(g, p))))} se start — packings: ${g.packings.map((p) => `${p.label} (${rs(effectivePackingRetail(g, p))})`).join(", ")}`
      : `Price: ${rs(effectiveRetail(g))}${g.unit === "kg" ? " /kg" : ""}`);
    if (onOffer) lines.push(`🎉 Is par offer hai — sirf ${rs(g.offerPrice as number)} (purana rate ${rs(g.retailPrice)})`);
    lines.push(g.stock > 0 ? "✅ Available hai — order kar sakte hain." : "❌ Abhi khatam hai (sold out).");
    return lines.join("\n");
  }
  lines.push(`Retail: ${rs(effectiveRetail(g))}${g.unit === "kg" ? " /kg" : ""}${onOffer ? offerNote : ""}${audience === "owner" ? ` · Wholesale: ${rs(g.wholesalePrice)}` : ""}`);
  lines.push(`Stock: ${qty(g.stock)} ${g.unit === "kg" ? "kg" : "pcs"} · SKU ${g.sku}${g.barcode ? ` · Barcode ${g.barcode}` : ""}`);
  if (g.packings?.length) {
    lines.push(`📦 Packings: ${g.packings.map((p) => audience === "owner" ? `${p.label} (R ${rs(effectivePackingRetail(g, p))} / W ${rs(p.wholesalePrice)})` : `${p.label} (${rs(effectivePackingRetail(g, p))})`).join(", ")}`);
  }
  return lines.join("\n");
}

function lowStockAnswer(s: Snap, audience: Audience): string {
  const gl = s.grocery.filter((g) => g.stock <= gLowAt(g)).sort((a, b) => a.stock - b.stock);
  const ml = s.menu.filter((m) => (m.stock ?? 0) <= (m.lowStock ?? 5)).sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0));
  if (!gl.length && !ml.length) return "✅ Koi item low stock par nahi hai — sab theek hai.";
  const out: string[] = [];
  if (gl.length) {
    out.push(`📉 ${shopKind().groceryType ? "Grocery" : "Dukaan"} low stock (${gl.length}):`);
    gl.slice(0, 12).forEach((g) => out.push(`• ${g.name} — ${qty(g.stock)} ${g.unit === "kg" ? "kg" : "pcs"} bacha (${headName(s, g)})`));
    if (gl.length > 12) out.push(`…aur ${gl.length - 12} items`);
  }
  if (ml.length && audience !== "customer") {
    out.push(`📉 Canteen low stock (${ml.length}):`);
    ml.slice(0, 8).forEach((m) => out.push(`• ${m.name} — ${m.stock ?? 0} pcs bacha`));
  }
  return out.join("\n");
}

const RESTRICTED = /wholesale|tholesale|profit|munafa|margin|udhaar|udhar|khata|sale kitni|aaj ki sale|total sale|sales|kamai|earning/;
const REFUSAL_STAFF = "🙏 Ye maloomat (wholesale rate / profit / udhaar / sales) sirf Owner ke liye hai — staff ko nahi dikhayi jati.\nMein aapko product ki retail price, stock, packings, ya pending orders bata sakta hoon.";
const REFUSAL_CUSTOMER = "🙏 Ye hamari internal maloomat hai, customers ko nahi bata sakte.\nMein aapko kisi product ki price, availability, ya aapke apne order ka status bata sakta hoon.";

// Dukaan ki qisam (Talha, 18 Nov 2026): assistant ki suggestions aur
// headings SHOP TYPE ke hisaab se — clothing/rental dukaan mein koi
// grocery-specific prompt ya lafz nahi aata.
function shopKind() {
  const sh = loadShop();
  return {
    hasCanteen: sh.hasCanteen,
    retail: hasRetail(sh),
    groceryType: sh.retailType === "grocery" || sh.retailType === "supermarket",
  };
}

export function chipsFor(audience: Audience): string[] {
  const kind = shopKind();
  switch (audience) {
    case "owner": return ["💰 Aaj ki sale kitni hai?", "💳 Tasdeeq baqi orders kitne hain?", "📉 Low stock items", "🏆 Best selling items", "🧾 Pending orders", "📒 Udhaar summary"];
    case "stock": return ["📉 Low stock list", "🚫 Out of stock items", "🕘 Recent stock entries", "🗂️ Kis head mein sab se zyada low hai?"];
    case "kitchen": return ["🎫 Pending tokens kitne hain?", "⏰ Sab se purana pending order", "🍽️ Dine-In vs Takeaway"];
    case "customer":
      if (kind.groceryType) return ["💸 Rs 500 mein snacks dikhao", "✅ Mera order confirm hua?", "📦 Mera order status", "🔍 Surf Excel ki price?"];
      if (kind.retail) return ["💸 Rs 500 ke andar items dikhao", "✅ Mera order confirm hua?", "📦 Mera order status", "🔍 Product dhoondo (naam likhein)"];
      return ["💸 Rs 500 mein khana dikhao", "✅ Mera order confirm hua?", "📦 Mera order status", "🔍 Product dhoondo (naam likhein)"];
    default: return ["🔍 Product dhoondo (naam likhein)", "📦 Pending orders", "❓ Bill kaise banayein?", "📉 Low stock items"];
  }
}

export function answerQuery(raw: string, ctx: AssistantCtx, snapData?: Snap): string {
  const q = raw.toLowerCase().trim();
  // Phase 2: the server endpoint passes a permission-scoped snapshot built
  // from PostgreSQL; the local snap() remains only as an offline fallback.
  const s = snapData ?? snap();
  const a = ctx.audience;
  if (!q) return "Kuch likhein ya neeche diye gaye sawalon mein se ek chunein.";

  // Restricted topics first — non-owners never see these numbers.
  if (a !== "owner" && RESTRICTED.test(q) && !/pending/.test(q)) {
    return a === "customer" ? REFUSAL_CUSTOMER : REFUSAL_STAFF;
  }

  // Greetings
  if (/^(salam|assalam|hello|hi|hey|aoa|hola)\b/.test(q)) {
    const who = a === "owner" ? "Owner" : a === "customer" ? "Customer" : a === "stock" ? "Stock Keeper" : a === "kitchen" ? "Kitchen" : "Staff";
    return `Wa-alaikum-salam! 👋 Mein aapka POS assistant hoon (${who} mode).\nNeeche ke sawalon mein se chunein, ya product ka naam likh kar pooch lein.`;
  }

  // Budget picks (customer + everyone: retail prices only)
  const budgetM = q.match(/(\d{2,6})/);
  if (budgetM && /(mein|andar|budget|tak|under|rs|rupee)/.test(q)) {
    const amt = parseInt(budgetM[1], 10);
    const words = ["snack", "biscuit", "chocolate", "drink", "juice", "chai", "tea", "coffee", "milk", "baby", "frozen", "fruit"];
    const word = words.find((w) => q.includes(w));
    let items = s.grocery.filter((g) => effectiveRetail(g) <= amt && g.stock > 0);
    if (word) items = items.filter((g) => g.name.toLowerCase().includes(word) || headName(s, g).toLowerCase().includes(word) || subName(s, g).toLowerCase().includes(word));
    items = items.sort((x, y) => effectiveRetail(y) - effectiveRetail(x)).slice(0, 8);
    if (!items.length) return `${rs(amt)} ke andar ${word ? `“${word}” mein ` : ""}koi available item nahi mila. Budget thora barha kar try karein.`;
    return [`💸 ${rs(amt)} ke andar ${word ? `${word} ke ` : ""}best options:`, ...items.map((g) => `• ${g.name} — ${rs(effectiveRetail(g))}${g.unit === "kg" ? "/kg" : ""}${offerActive(g) ? " 🎉 offer" : ""}`)].join("\n");
  }

  // Owner: today's sales
  if (a === "owner" && /(sale|revenue|aaj)/.test(q)) {
    const today = s.orders.filter(isToday);
    const total = today.reduce((t, o) => t + o.total, 0);
    const canteen = today.filter((o) => (o.mode ?? "canteen") === "canteen");
    const grocery = today.filter((o) => o.mode === "grocery");
    const online = today.filter((o) => o.source === "online");
    return `💰 Aaj ki sale: ${rs(total)} (${today.length} bills)\n• Canteen: ${rs(canteen.reduce((t, o) => t + o.total, 0))} (${canteen.length} bills)\n• Grocery: ${rs(grocery.reduce((t, o) => t + o.total, 0))} (${grocery.length} bills)\n• Online orders: ${online.length} (${rs(online.reduce((t, o) => t + o.total, 0))})`;
  }

  // Owner: best sellers
  if (a === "owner" && /(best|top|zyada bik|popular|selling)/.test(q)) {
    let pool = s.orders.filter(isToday);
    let note = "Aaj ke best sellers:";
    if (!pool.length) { pool = s.orders; note = "Aaj abhi koi sale nahi — kul record ke best sellers:"; }
    if (!pool.length) return "Abhi tak koi order record nahi hai.";
    const agg = new Map<string, number>();
    pool.forEach((o) => o.lines.forEach((l) => agg.set(l.name, (agg.get(l.name) ?? 0) + l.qty)));
    const top = [...agg.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5);
    return [`🏆 ${note}`, ...top.map(([n, nq], i) => `${i + 1}. ${n} — ${qty(nq)} sold`)].join("\n");
  }

  // Owner: udhaar summary
  if (a === "owner" && /(udhaar|udhar|khata)/.test(q)) {
    const ud = s.orders.filter((o) => o.payment === "Udhaar");
    if (!ud.length) return "📒 Udhaar khata saaf hai — koi udhaar order nahi.";
    const total = ud.reduce((t, o) => t + o.total, 0);
    const lines = ud.slice(0, 8).map((o) => `• ${o.udhaarName ?? o.customerName ?? "—"} — ${rs(o.total)} (${billNoOf(o)})`);
    return [`📒 Udhaar summary: ${ud.length} orders · kul ${rs(total)}`, ...lines].join("\n");
  }

  // Payment verification backlog — owner: both shops; staff: their own
  // shop only (from their tab grants); kitchen: canteen side.
  if (a !== "customer" && /(tasdeeq|verif|proof|payment.*pending|pending.*payment)/.test(q)) {
    let pool = s.orders.filter((o) => o.source === "online" && o.paymentStatus === "proof_pending");
    let scope = "dono shops";
    const onlyMode = a === "kitchen" ? "canteen"
      : a === "staff" && ctx.staffTabs?.length === 1 && ctx.staffTabs[0] === "grocery" ? "grocery"
      : a === "staff" && ctx.staffTabs?.length === 1 && ctx.staffTabs[0] === "canteen" ? "canteen"
      : null;
    if (onlyMode) {
      pool = pool.filter((o) => (o.mode ?? "canteen") === onlyMode);
      scope = onlyMode === "grocery" ? "sirf grocery" : "sirf canteen";
    }
    if (!pool.length) return "💳 Koi order payment tasdeeq ke liye baqi nahi hai — sab clear hain. ✅";
    const lines = pool.slice(0, 6).map((o) => `• ${billNoOf(o)} · ${o.mode === "grocery" ? "🛒 Grocery" : "🍔 Canteen"} · ${o.customerName ?? "—"} · ${rs(o.total)}${o.paymentProof ? ` · ${o.paymentProof.method}` : ""}`);
    return [`💳 Payment tasdeeq baqi: ${pool.length} order(s) (${scope}) — Dashboard → Online Payment Verification se confirm karein:`, ...lines].join("\n");
  }

  // Stock keeper: head with most low items
  if (a === "stock" && /(kis head|head.*low|zyada low)/.test(q)) {
    const counts = new Map<string, number>();
    s.grocery.filter((g) => g.stock <= gLowAt(g)).forEach((g) => counts.set(g.headId, (counts.get(g.headId) ?? 0) + 1));
    if (!counts.size) return "✅ Kisi head mein low stock nahi hai.";
    const top = [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5);
    return ["🗂️ Low stock heads (sab se zyada pehle):", ...top.map(([hid, n]) => `• ${s.heads.find((h) => h.id === hid)?.name ?? hid} — ${n} items low`)].join("\n");
  }

  // Stock keeper: recent entries
  if (a === "stock" && /(recent|entr|history|pichl|last|record)/.test(q)) {
    if (!s.entries.length) return "Abhi tak koi stock entry nahi hai.";
    const last = [...s.entries].sort((x, y) => y.at.localeCompare(x.at)).slice(0, 6);
    return ["🕘 Recent stock entries:", ...last.map((e) => `• ${e.at.slice(0, 10)} — ${e.itemName}: ${e.type === "add" ? "+" : "−"}${qty(e.qty)} ${e.unit} (${e.by})`)].join("\n");
  }

  // Stock keeper: out of stock
  if (a === "stock" && /(out of stock|khatam|zero)/.test(q)) {
    const gz = s.grocery.filter((g) => g.stock <= 0);
    const mz = s.menu.filter((m) => (m.stock ?? 0) <= 0);
    if (!gz.length && !mz.length) return "✅ Koi item bilkul khatam nahi hai.";
    return [
      ...(gz.length ? [`🚫 Grocery out of stock (${gz.length}):`, ...gz.slice(0, 12).map((g) => `• ${g.name} (${headName(s, g)})`)] : []),
      ...(mz.length ? [`🚫 Canteen out of stock (${mz.length}):`, ...mz.slice(0, 8).map((m) => `• ${m.name}`)] : []),
    ].join("\n");
  }

  // Low stock (owner / staff / stock)
  if (a !== "customer" && /(low stock|kam stock|low hai|low items)/.test(q)) return lowStockAnswer(s, a);

  // Kitchen intents — proof_pending / rejected orders never count here:
  // the kitchen only ever sees payment-cleared orders.
  if (a === "kitchen" || /(token|kitchen)/.test(q)) {
    const pend = s.orders.filter((o) => (o.mode ?? "canteen") === "canteen" && isPaymentCleared(o) && o.status !== "ready");
    if (/(purana|oldest|pehle wala|first)/.test(q)) {
      if (!pend.length) return "✅ Kitchen mein koi pending order nahi hai.";
      const oldest = [...pend].sort((x, y) => x.createdAt.localeCompare(y.createdAt))[0];
      return `⏰ Sab se purana pending: Token #${oldest.token} (${billNoOf(oldest)})\n${oldest.lines.map((l) => `• ${l.name} × ${qty(l.qty)}`).join("\n")}\nTime: ${oldest.createdAt.slice(11, 16)}`;
    }
    if (/(dine|takeaway|take away)/.test(q)) {
      const dine = pend.filter((o) => o.orderType === "dine-in" || o.tableNo).length;
      return `🍽️ Pending mein: Dine-In ${dine} · Takeaway ${pend.length - dine} (kul pending ${pend.length})`;
    }
    if (/(pending|token)/.test(q)) {
      if (!pend.length) return "✅ Kitchen clear hai — koi pending token nahi.";
      return `🎫 Pending tokens (${pend.length}): ${pend.slice(0, 12).map((o) => `#${o.token}`).join(", ")}${pend.length > 12 ? " …" : ""}`;
    }
  }

  // Pending orders (owner / staff / stock) — fulfilment pending only:
  // payment-unverified orders are counted by the tasdeeq intent above.
  if (a !== "customer" && /pending/.test(q)) {
    const pend = s.orders.filter((o) => isPaymentCleared(o) && o.status !== "ready");
    if (!pend.length) return "✅ Koi pending order nahi hai — sab ready hain.";
    const gc = pend.filter((o) => o.mode === "grocery").length;
    const cc = pend.length - gc;
    const lines = pend.slice(0, 6).map((o) => `• ${billNoOf(o)} · Token #${o.token} · ${o.mode === "grocery" ? "🛒 Grocery" : "🍽️ Canteen"} · ${rs(o.total)} · ${o.status}`);
    return [`🧾 Pending orders: ${pend.length} (Canteen ${cc} · Grocery ${gc})`, ...lines].join("\n");
  }

  // Customer: "mera order confirm hua?" — answered from the paymentStatus
  // of their latest online order (payment-first proof flow).
  if (a === "customer" && /(confirm|tasdeeq|proof|reject|payment)/.test(q)) {
    const mine = s.orders.filter((o) => o.source === "online" && ctx.customerMobile && o.customerMobile === ctx.customerMobile);
    if (!mine.length) return "📦 Aapka koi online order nahi mila. Pehle order place karein — phir yahan status mil jayega.";
    const o = mine[0];
    if (o.paymentStatus === "proof_pending") return `⏳ ${billNoOf(o)} — Payment ki tasdeeq abhi BAQI hai.\nAapne ${rs(o.paymentProof?.amount ?? o.total)} ka proof (${o.paymentProof?.method ?? "Online"}) bheja tha. Shop tasdeeq kare to order confirm hoga aur token milega — thora intezaar karein.`;
    if (o.paymentStatus === "rejected") return `❌ ${billNoOf(o)} — Payment REJECT ho gayi hai.\nWajah: ${o.rejectReason ?? "—"}\nSahi payment karke My Orders mein is order ko kholein aur "Dobara Proof Upload Karein" se naya proof bhejein.`;
    if (o.paymentStatus === "confirmed") return `✅ ${billNoOf(o)} — Payment CONFIRM ho chuki hai (Token #${o.token}).\nOrder ${o.status === "ready" ? "READY hai — counter se le lein 🎉" : "taiyari mein hai, ready hote hi status badal jayega."}`;
    return `ℹ️ ${billNoOf(o)} par proof wala payment flow nahi tha (Cash / Udhaar order tha) — is ka order status: ${o.status === "ready" ? "✅ READY" : o.status === "preparing" ? "taiyari mein hai" : "queue mein hai"}.`;
  }

  // Customer: own order status
  if (a === "customer" && /(mera order|order status|status|token|mera parcel)/.test(q)) {
    const mine = s.orders.filter((o) => o.source === "online" && ctx.customerMobile && o.customerMobile === ctx.customerMobile);
    if (!mine.length) return "📦 Aapka koi online order nahi mila. Pehle order place karein — phir yahan status mil jayega.";
    const last = mine.slice(0, 3).map((o) => {
      const payNote = o.paymentStatus === "proof_pending" ? " · ⏳ Payment tasdeeq baqi" : o.paymentStatus === "rejected" ? " · ❌ Payment reject — dobara proof upload karein" : o.paymentStatus === "confirmed" ? " · ✅ Payment confirm" : "";
      const st = o.paymentStatus === "proof_pending" || o.paymentStatus === "rejected" ? "Payment verification mein hai" : o.status === "pending" ? "Queue mein hai ⏳" : o.status === "preparing" ? (o.mode === "grocery" ? "Pack ho raha hai 📦" : "Taiyar ho raha hai 👨‍🍳") : "✅ READY — counter se le lein";
      return `• ${billNoOf(o)} · Token ${o.token > 0 ? `#${o.token}` : "(tasdeeq ke baad)"} · ${rs(o.total)} — ${st}${payNote}`;
    });
    return ["📦 Aapke recent orders:", ...last].join("\n");
  }

  // How-to hints
  if (/(kaise|how|scan|bill bana|madad|help)/.test(q)) {
    if (a === "customer") return `❓ Madad:\n• Product dhoondne ke liye naam likhein ya budget batayein (e.g. “Rs 500 mein ${shopKind().groceryType ? "snacks" : "items"}”).\n• Order: shop chunein → items cart mein daalein → Checkout.\n• Apna status: “Mera order status” likhein.`;
    return "❓ Quick madad:\n• Bill banana: tile tap karein ya barcode scan karein → Payment → method chunein → Complete.\n• Packing wala product: tile tap par chooser khulta hai — size chunein.\n• Weight items (kg): tile tap = 0.5 kg, bill mein +/− se barhayein.\n• Scan na chale to SKU type karke Enter dabayein.";
  }

  // Product / menu search — the everyday case
  const gp = findProducts(s, q);
  if (gp.length) return gp.map((g) => productAnswer(s, g, a)).join("\n\n");
  const mp = findMenu(s, q);
  if (mp.length && a !== "stock") {
    return mp.map((m) => a === "customer"
      ? `🍽️ ${m.name} — ${rs(m.price)}${(m.stock ?? 0) > 0 ? " · Available" : " · Khatam"}`
      : `🍽️ ${m.name} (${m.category}) — ${rs(m.price)} · Stock: ${m.stock ?? 0} pcs`).join("\n");
  }

  return "🤔 Ye samajh nahi aaya. Product ka naam likhein (e.g. “Surf Excel”), ya neeche diye gaye sawalon mein se ek chunein.";
}
