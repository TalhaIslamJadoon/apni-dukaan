"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import TopBar from "@/components/TopBar";
import AIAssistant from "@/components/AIAssistant";
import { GuidelineButton } from "@/components/Guideline";
import { apiGet } from "@/lib/api";
import {
  CATEGORIES, CATEGORY_STYLE, Category, CustomerAccount, Deal, GroceryItem, GroceryHead, GrocerySubHead, PackingOption, MenuItem, Order, PaymentMethod, ProofPaymentMethod,
  loadMenu, saveMenu, loadGrocery, saveGrocery, loadGroceryHeads, loadGrocerySubHeads, groceryImage, loadOrders, saveOrders, nextToken, nextBillNo, isToday, adjustStockForOrder,
  loadDeals, dealValue, dealContentsText, dealOrderLine,
  getSessionAccount, loginAccount, registerAccount, setSession, useShop, hasRetail,
  verifyEmailCode, verifyMobileCode, resendVerificationCode, type DeliveryState,
  offerActive, effectiveRetail, effectivePackingRetail, lineIsOffer, offerPackingOf,
} from "@/lib/store";
import { DisabledSectionNotice } from "@/components/BusinessGate";
import DealContentsRows from "@/components/DealContents";
import SetupScreen from "@/components/SetupScreen";

// Payment-proof screenshots are compressed client-side before they are
// stored with the order (max 1200px long side, JPEG ~0.72) so the
// prototype's localStorage stays sane. Phase 2 stores proofs as files on
// the server instead of data URLs.
function compressProof(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const max = 1200;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const c2d = canvas.getContext("2d");
        if (!c2d) { URL.revokeObjectURL(url); reject(new Error("no canvas")); return; }
        c2d.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      } catch (e) { URL.revokeObjectURL(url); reject(e instanceof Error ? e : new Error("compress failed")); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image load failed")); };
    img.src = url;
  });
}

// Grocery cart line identity = product + variant + packing (same product
// in two packings = two lines; stock decrements per product, base units).
const gLineKey = (l: { item: GroceryItem; packing?: PackingOption; variant?: string }) => `${l.item.id}::${l.variant ?? ""}::${l.packing?.label ?? ""}`;
const gLineName = (l: { item: GroceryItem; packing?: PackingOption; variant?: string }) =>
  l.variant && l.packing ? `${l.item.name} (${l.variant} · ${l.packing.label})`
  : l.variant ? `${l.item.name} (${l.variant})`
  : l.packing ? `${l.item.name} (${l.packing.label})`
  : `${l.item.name}${l.item.unit === "kg" ? " (kg)" : ""}`;

// ─────────────────────────────────────────────────────────────────────────────
// TWO customer kinds (Talha, 14 Nov 2026):
//  A) WALK-IN / TABLE-QR customers: NO account, NO login — scan QR → write
//     NAME + TABLE NUMBER → Dine-In / Takeaway → order. An ID is asked ONLY
//     if they pick Udhaar ("Udhaar ke liye ID likhein").
//  B) REMOTE online orders (hostel room / office / anywhere): an ACCOUNT is
//     MANDATORY (fake-order protection). Account = name + mobile (login) +
//     password + place; student/staff ID inside the account is OPTIONAL
//     (needed only for Udhaar). PROTOTYPE: demo-grade local accounts —
//     Phase 2 moves them to the PostgreSQL backend with hashed passwords.
// ─────────────────────────────────────────────────────────────────────────────

type Entry = "table" | "remote";
type PayChoice = "online" | "counter" | "udhaar";
const PAY_MAP: Record<PayChoice, PaymentMethod> = { online: "Online", counter: "Counter", udhaar: "Udhaar" };

const STATUS_STEPS = [
  { key: "pending", label: "📥 Received" },
  { key: "preparing", label: "🍳 Preparing" },
  { key: "ready", label: "✅ Ready" },
] as const;
const GROCERY_STEPS = [
  { key: "pending", label: "📥 Received" },
  { key: "preparing", label: "📦 Packing" },
  { key: "ready", label: "✅ Ready for Pickup" },
] as const;

export default function OnlinePage() {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [cat, setCat] = useState<Category | "All">("All");
  const [entry, setEntry] = useState<Entry | null>(null);
  const [fromQr, setFromQr] = useState(false);
  const [name, setName] = useState("");
  const [tableNo, setTableNo] = useState("");
  const [mobile, setMobile] = useState("");
  const [orderType, setOrderType] = useState<"dine-in" | "takeaway">("dine-in");
  const [deals, setDeals] = useState<Deal[]>([]);
  const [dealCart, setDealCart] = useState<{ deal: Deal; qty: number }[]>([]);
  const [cart, setCart] = useState<{ item: MenuItem; qty: number }[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [pay, setPay] = useState<PayChoice>("counter");
  const [udhaarId, setUdhaarId] = useState("");
  // Payment-first proof flow (online payment): method + optional txn id +
  // the REQUIRED compressed proof screenshot.
  const [payMethod, setPayMethod] = useState<ProofPaymentMethod>("JazzCash");
  // Merchant QR availability per method — Owner ne Settings se jo QR lagaya
  // ho, wahi method choose karne par bara QR yahan nazar ata hai (scan-and-
  // pay). QR na ho to sirf number wala purana tareeqa chalta hai.
  const [qrProviders, setQrProviders] = useState<Record<string, boolean>>({});
  useEffect(() => {
    apiGet<{ merchants: { provider: string; hasQr: boolean }[] }>("/public/payment-options")
      .then((d) => {
        const map: Record<string, boolean> = {};
        (d.merchants ?? []).forEach((m) => { if (m.hasQr) map[m.provider] = true; });
        setQrProviders(map);
      })
      .catch(() => { /* numbers-only flow stays */ });
  }, []);
  const [txnId, setTxnId] = useState("");
  const [proofImg, setProofImg] = useState<string | null>(null);
  // Re-upload after a rejection (tracked order panel)
  const [reTxnId, setReTxnId] = useState("");
  const [reProofImg, setReProofImg] = useState<string | null>(null);
  // Customer toast when THEIR order's payment gets confirmed / rejected
  const [payToast, setPayToast] = useState<{ ok: boolean; text: string } | null>(null);
  const prevPayRef = useRef<Map<string, string>>(new Map());
  const accountRef = useRef<CustomerAccount | null>(null);
  const nameRef = useRef("");
  const [myOrders, setMyOrders] = useState<Order[]>([]);
  const [trackId, setTrackId] = useState<string | null>(null);
  const shop = useShop();
  // Remote shop choice (after login): one order = ONE shop, never mixed
  const [remoteShop, setRemoteShop] = useState<"canteen" | "grocery" | null>(null);
  const [gItems, setGItems] = useState<GroceryItem[]>([]);
  const [gHeads, setGHeads] = useState<GroceryHead[]>([]);
  const [gSubs, setGSubs] = useState<GrocerySubHead[]>([]);
  const [gHead, setGHead] = useState<string>("all");
  const [gSub, setGSub] = useState<string>("all");
  const [gChooserItem, setGChooserItem] = useState<GroceryItem | null>(null);
  const [gSearch, setGSearch] = useState("");
  const [gCart, setGCart] = useState<{ item: GroceryItem; qty: number; packing?: PackingOption; variant?: string }[]>([]);
  const [gChooserVariant, setGChooserVariant] = useState<string | null>(null);
  // Remote customer account (mandatory for remote orders only)
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [loginMobile, setLoginMobile] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [authErr, setAuthErr] = useState("");
  const [reg, setReg] = useState({ name: "", mobile: "", password: "", email: "", placeType: "Hostel Room" as CustomerAccount["placeType"], placeDetail: "", studentId: "" });
  // Account verification (Talha, 15 Nov 2026): email code LAZMI, mobile
  // code OPTIONAL (Skip allowed). Delivery state honestly dikhta hai —
  // NOT_CONFIGURED matlab deployment par email/SMS service configure
  // hone par code jayega (server dev mode mein code console mein ata hai).
  const [verifyDelivery, setVerifyDelivery] = useState<DeliveryState | null>(null);
  const [mobileSkipped, setMobileSkipped] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const retailOn = hasRetail(shop);

  useEffect(() => {
    setMenu(loadMenu());
    setDeals(loadDeals());
    setGItems(loadGrocery());
    setGHeads(loadGroceryHeads());
    setGSubs(loadGrocerySubHeads());
    const acc = getSessionAccount();
    if (acc) { setAccount(acc); setName(acc.name); setMobile(acc.mobile); }
    // Table QR link: /online?table=4 — pre-fill table + Dine-In
    try {
      const t = new URLSearchParams(window.location.search).get("table");
      if (t && !isNaN(parseInt(t, 10))) {
        setEntry("table"); setFromQr(true);
        setTableNo(String(parseInt(t, 10))); setOrderType("dine-in");
      }
      const saved = JSON.parse(window.localStorage.getItem("canteen-pos-customer") || "null");
      if (saved?.name) setName(saved.name);
      if (saved?.mobile) setMobile(saved.mobile);
    } catch {}
    refreshMine();
    const timer = setInterval(refreshMine, 1500);
    return () => clearInterval(timer);
  }, []);

  // Catalogue: the mount read above can race the server hydration (the
  // store cache starts as the built-in sample) — re-read whenever the
  // store signals a fresh server catalogue, so prices/offers/stock shown
  // to customers are always the server's, never the sample's.
  useEffect(() => {
    const reload = () => {
      setMenu(loadMenu());
      setDeals(loadDeals());
      setGItems(loadGrocery());
      setGHeads(loadGroceryHeads());
      setGSubs(loadGrocerySubHeads());
    };
    window.addEventListener("pos-catalog-changed", reload);
    return () => window.removeEventListener("pos-catalog-changed", reload);
  }, []);

  // Business Setup gating: sirf EK dukaan on ho to remote choice wahi
  // khud select ho jati hai — chooser screen hi nahi ati.
  useEffect(() => {
    if (entry === "remote" && account && !remoteShop) {
      if (shop.hasCanteen && !retailOn) setRemoteShop("canteen");
      else if (!shop.hasCanteen && retailOn) setRemoteShop("grocery");
    }
  }, [entry, account, remoteShop, shop.hasCanteen, retailOn]);

  accountRef.current = account;
  nameRef.current = name;

  useEffect(() => {
    if (!payToast) return;
    const t = setTimeout(() => setPayToast(null), 7000);
    return () => clearTimeout(t);
  }, [payToast]);

  function refreshMine() {
    const all = loadOrders().filter((o) => o.source === "online" && isToday(o));
    // Visual toast (no sound for customers) when MY order's payment flips
    // proof_pending → confirmed / rejected while I am watching this page.
    const prev = prevPayRef.current;
    for (const o of all) {
      const before = prev.get(o.id);
      const now = o.paymentStatus;
      const mine = accountRef.current
        ? o.customerMobile === accountRef.current.mobile
        : !!nameRef.current.trim() && o.customerName === nameRef.current.trim();
      if (mine && before === "proof_pending" && now === "confirmed") {
        setPayToast({ ok: true, text: `✅ Payment CONFIRM ho gayi! Aapka order (${o.mode === "grocery" ? "Grocery" : "Canteen"} · Rs ${o.total.toLocaleString()}) confirm hai — Token ${o.token} mil gaya hai.` });
      } else if (mine && before === "proof_pending" && now === "rejected") {
        setPayToast({ ok: false, text: `❌ Payment REJECT ho gayi — wajah: ${o.rejectReason ?? "—"}. My Orders se dobara proof upload karein.` });
      }
      if (now) prev.set(o.id, now);
    }
    setMyOrders(all);
  }

  const total = useMemo(() => cart.reduce((s, l) => s + l.item.price * l.qty, 0), [cart]);
  const cartCount = cart.reduce((s, l) => s + l.qty, 0);
  // 🎁 Canteen deals bill at the DEAL PRICE exactly (deal.price × qty).
  const activeDeals = deals.filter((d) => d.active);
  const dealTotal = useMemo(() => dealCart.reduce((s, l) => s + l.deal.price * l.qty, 0), [dealCart]);
  const dealCount = dealCart.reduce((s, l) => s + l.qty, 0);
  const canteenTotal = total + dealTotal;
  const gPrice = (l: { item: GroceryItem; packing?: PackingOption }) => (l.packing ? effectivePackingRetail(l.item, l.packing) : effectiveRetail(l.item));
  const gTotal = useMemo(() => Math.round(gCart.reduce((s, l) => s + gPrice(l) * l.qty, 0)), [gCart]);
  const gCount = gCart.reduce((s, l) => s + l.qty, 0);
  const groceryActive = entry === "remote" && remoteShop === "grocery";
  const activeTotal = groceryActive ? gTotal : canteenTotal;
  const activeCount = groceryActive ? gCount : cartCount + dealCount;
  // Grocery heads → sub-heads: same two-row chips behaviour as the Grocery
  // POS — the filters apply normally, but a search looks across ALL heads.
  const gSearching = gSearch.trim().length > 0;
  const gHeadCount = (id: string) => gItems.filter((it) => it.headId === id).length;
  const gSubCount = (id: string) => gItems.filter((it) => it.subId === id).length;
  const gVisible = gItems.filter((it) => {
    const q = gSearch.trim().toLowerCase();
    if (q) return it.name.toLowerCase().includes(q) || it.sku.includes(q)
      || (it.brand ?? "").toLowerCase().includes(q)
      || (it.variants ?? []).some((v) => v.name.toLowerCase().includes(q));
    if (gHead !== "all" && it.headId !== gHead) return false;
    if (gHead !== "all" && gSub !== "all" && it.subId !== gSub) return false;
    return true;
  });
  const visible = cat === "All" ? menu : menu.filter((m) => m.category === cat);

  const nameOk = name.trim().length >= 2;
  // Tables are 1..tableCount (Owner → Tables & QR) — a QR ya haath se likha
  // number is range se bahar ho to order valid NAHI (server bhi table ko
  // inactive/nahi-milta keh kar rok deta hai).
  const tableNum = parseInt(tableNo, 10);
  const tableLimit = shop.tableCount ?? 8;
  const tableInRange = !isNaN(tableNum) && tableNum >= 1 && tableNum <= tableLimit;
  const tableInvalid = entry === "table" && orderType === "dine-in" && tableNo.trim() !== "" && !tableInRange;
  const tableOk = entry !== "table" || orderType === "takeaway" || (tableNo.trim() !== "" && tableInRange);
  const mobileOk = entry !== "remote" || mobile.trim().length >= 10;
  // Email confirmation ke baghair account INACTIVE hai — order nahi ho
  // sakta (server bhi 403 EMAIL_NOT_VERIFIED deta hai). Purane/demo
  // accounts grandfathered hain (un ka flag server par true ata hai).
  const emailVerified = !account || account.emailVerified !== false;
  const formOk = !!entry && nameOk && tableOk && mobileOk && (entry !== "remote" || (!!account && emailVerified));
  // Udhaar: table customers write an ID at payment; remote customers must
  // have an ID saved in their account. No ID → no udhaar (money-safety rule).
  const udhaarOk = pay !== "udhaar"
    || (entry === "remote" ? !!(account?.studentId && account.studentId.trim()) : udhaarId.trim().length >= 1);
  // Remote customers are NOT physically present → no Cash/Counter option
  // there (Talha): remote = Online Payment (proof) or Udhaar only. A stale
  // "counter" state (from the table flow) therefore counts as "online".
  const effPay: PayChoice = entry === "remote" && pay === "counter" ? "online" : pay;
  const proofRequired = effPay === "online";
  const payNumber = payMethod === "JazzCash" ? shop.jazzcashNumber : payMethod === "Easypaisa" ? shop.easypaisaNumber : shop.raastInfo;

  async function onProofFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try { setProofImg(await compressProof(f)); } catch { /* unreadable image — customer retries */ }
  }
  async function onReProofFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try { setReProofImg(await compressProof(f)); } catch { /* ignore */ }
  }
  // Rejected order → customer uploads a fresh proof: order goes back to
  // proof_pending (reason cleared) and the stock is deducted again (the
  // rejection had restored it). Token still comes only at confirmation.
  function reuploadProof(orderId: string) {
    if (!reProofImg) return;
    const all = loadOrders();
    const fresh = all.find((o) => o.id === orderId);
    if (!fresh || fresh.paymentStatus !== "rejected") return;
    const updated: Order = {
      ...fresh,
      paymentStatus: "proof_pending",
      rejectReason: undefined,
      paymentProof: {
        method: fresh.paymentProof?.method ?? "JazzCash",
        txnId: reTxnId.trim() || undefined,
        amount: fresh.total,
        proofImage: reProofImg,
        uploadedAt: Date.now(),
      },
    };
    adjustStockForOrder(updated, -1);
    saveOrders(all.map((o) => (o.id === orderId ? updated : o)));
    setReProofImg(null); setReTxnId("");
    refreshMine();
  }
  const tracked = myOrders.find((o) => o.id === trackId)
    || myOrders.filter((o) => nameOk && o.customerName === name.trim())[0];
  const myRemoteOrders = account ? myOrders.filter((o) => o.customerMobile === account.mobile) : [];

  function chooseEntry(e: Entry) {
    if (e === "remote" && !account) { setAuthOpen(true); setAuthErr(""); return; }
    setEntry(e);
    if (e === "remote") { setOrderType("takeaway"); setPay("online"); } // remote: payment-first is the default
    if (e === "table") { setOrderType("dine-in"); setPay("counter"); } // table: Cash is the default (online optional)
  }
  async function doLogin() {
    // Phase 2: accounts live on the server — login is an API call now.
    const acc = await loginAccount(loginMobile.trim(), loginPass);
    if (!acc) { setAuthErr("❌ Mobile ya password ghalat hai — dobara try karein, ya naya account banayein."); return; }
    setAccount(acc); setName(acc.name); setMobile(acc.mobile);
    setAuthOpen(false); setEntry("remote"); setOrderType("takeaway"); setPay("online");
  }
  async function doRegister() {
    if (reg.name.trim().length < 2) return setAuthErr("❌ Apna poora naam likhein.");
    if (reg.mobile.trim().length < 10) return setAuthErr("❌ Sahi mobile number likhein (yehi aapka login hoga).");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reg.email.trim())) return setAuthErr("❌ Sahi email address likhein — confirmation code isi par ayega.");
    if (reg.password.length < 4) return setAuthErr("❌ Password kam az kam 4 characters ka rakhein.");
    if (!reg.placeDetail.trim()) return setAuthErr("❌ Room / Office detail likhein (e.g. Room 12).");
    let r;
    try {
      r = await registerAccount({
        name: reg.name.trim(), mobile: reg.mobile.trim(), password: reg.password, email: reg.email.trim(),
        placeType: reg.placeType, placeDetail: reg.placeDetail.trim(),
        studentId: reg.studentId.trim() || undefined,
      });
    } catch {
      return setAuthErr("❌ Account nahi ban saka — connection check karke dobara try karein.");
    }
    if (r.status === "exists") return setAuthErr("❌ Is mobile number par account pehle se hai — Login karein.");
    if (r.emailDelivery) setVerifyDelivery(r.emailDelivery);
    const acc = getSessionAccount();
    if (acc) { setAccount(acc); setName(acc.name); setMobile(acc.mobile); }
    setAuthOpen(false); setEntry("remote"); setOrderType("takeaway"); setPay("online");
    // Account bana — ab email confirmation panel khulega (neeche shop
    // screen par); code confirm hue baghair order nahi hoga.
  }
  // ── Verification actions (panel neeche render hota hai) ────────────────
  const [emailCode, setEmailCode] = useState("");
  const [mobileCode, setMobileCode] = useState("");
  const [mobileCodeSent, setMobileCodeSent] = useState(false);
  const [verifyErr, setVerifyErr] = useState("");
  const [verifyMsg, setVerifyMsg] = useState("");
  async function doVerifyEmail() {
    setVerifyErr(""); setVerifyMsg("");
    try {
      await verifyEmailCode(emailCode.trim());
      const acc = getSessionAccount();
      if (acc) setAccount(acc);
      setVerifyMsg("✅ Email confirm ho gayi — ab aap order kar sakte hain!");
    } catch (e) {
      setVerifyErr(`❌ ${(e as Error).message || "Code confirm nahi hua — dobara try karein."}`);
    }
  }
  async function doVerifyMobile() {
    setVerifyErr(""); setVerifyMsg("");
    try {
      await verifyMobileCode(mobileCode.trim());
      const acc = getSessionAccount();
      if (acc) setAccount(acc);
      setVerifyMsg("✅ Mobile number bhi confirm ho gaya!");
    } catch (e) {
      setVerifyErr(`❌ ${(e as Error).message || "Code confirm nahi hua — dobara try karein."}`);
    }
  }
  async function doResend(channel: "email" | "mobile") {
    setVerifyErr(""); setVerifyMsg("");
    try {
      const d = await resendVerificationCode(channel);
      if (channel === "email") setVerifyDelivery(d);
      setVerifyMsg(d.state === "sent"
        ? `📨 Naya code bhej diya gaya hai (${channel === "email" ? "email" : "SMS"} par) — 10 minute valid hai.`
        : "ℹ️ Code abhi nahi bheja ja saka — shop ke system par email/SMS service deployment ke waqt configure hogi; code wahan se ayega.");
    } catch (e) {
      setVerifyErr(`❌ ${(e as Error).message || "Code dobara nahi bheja ja saka."}`);
    }
  }
  function doLogout() {
    setSession(null); setAccount(null); setEntry(null); setAuthOpen(false);
  }
  function add(item: MenuItem) {
    setCart((c) => {
      const f = c.find((l) => l.item.id === item.id);
      return f ? c.map((l) => (l.item.id === item.id ? { ...l, qty: l.qty + 1 } : l)) : [...c, { item, qty: 1 }];
    });
  }
  function chQty(id: string, d: number) {
    setCart((c) => c.map((l) => (l.item.id === id ? { ...l, qty: l.qty + d } : l)).filter((l) => l.qty > 0));
  }
  function addDeal(deal: Deal) {
    setDealCart((c) => {
      const f = c.find((l) => l.deal.id === deal.id);
      return f ? c.map((l) => (l.deal.id === deal.id ? { ...l, qty: l.qty + 1 } : l)) : [...c, { deal, qty: 1 }];
    });
  }
  function chDealQty(id: string, d: number) {
    setDealCart((c) => c.map((l) => (l.deal.id === id ? { ...l, qty: l.qty + d } : l)).filter((l) => l.qty > 0));
  }
  const gStep = (it: GroceryItem) => (it.unit === "kg" ? 0.5 : 1);
  function gAdd(item: GroceryItem) {
    // Phase 2 flow: flavours first (variant), then packing — steps that
    // don't exist are skipped (same rule as the Grocery POS).
    const named = (item.variants ?? []).filter((v) => v.name !== "Standard");
    if (named.length) { setGChooserItem(item); setGChooserVariant(null); return; }
    if (item.packings && item.packings.length) { setGChooserItem(item); setGChooserVariant("Standard"); return; }
    setGCart((c) => {
      const f = c.find((l) => l.item.id === item.id && !l.packing && !l.variant);
      return f ? c.map((l) => (l.item.id === item.id && !l.packing && !l.variant ? { ...l, qty: Math.round((l.qty + gStep(item)) * 10) / 10 } : l)) : [...c, { item, qty: gStep(item) }];
    });
  }
  function gAddVariant(item: GroceryItem, variantName: string) {
    setGCart((c) => {
      const key = gLineKey({ item, variant: variantName });
      const f = c.find((l) => gLineKey(l) === key);
      return f ? c.map((l) => (gLineKey(l) === key ? { ...l, qty: l.qty + 1 } : l)) : [...c, { item, qty: 1, variant: variantName }];
    });
    setGChooserItem(null); setGChooserVariant(null);
  }
  function gAddPacking(item: GroceryItem, packing: PackingOption, variantName?: string) {
    setGCart((c) => {
      const key = gLineKey({ item, packing, variant: variantName });
      const f = c.find((l) => gLineKey(l) === key);
      return f ? c.map((l) => (gLineKey(l) === key ? { ...l, qty: l.qty + 1 } : l)) : [...c, { item, qty: 1, packing, variant: variantName }];
    });
    setGChooserItem(null); setGChooserVariant(null);
  }
  function gChQty(key: string, dir: 1 | -1) {
    setGCart((c) => c.map((l) => (gLineKey(l) === key ? { ...l, qty: Math.round((l.qty + dir * (l.packing ? 1 : gStep(l.item))) * 10) / 10 } : l)).filter((l) => l.qty > 0));
  }

  function placeOrder() {
    // Payment-first gate: an Online-Payment order cannot be placed without
    // its proof screenshot — for remote AND table-QR orders alike.
    if (proofRequired && !proofImg) return;
    if (groceryActive) {
      // ── Online GROCERY order → grocery packing queue (NOT the kitchen) ──
      // Payment-first: with a proof attached the order waits as
      // proof_pending (token 0, NOT in the packing queue) until the owner
      // confirms the payment — the token is assigned at confirmation.
      if (!formOk || !udhaarOk || gCart.length === 0 || !account) return;
      const orders = loadOrders();
      const order: Order = {
        id: `ord-${Date.now()}`,
        billNo: nextBillNo(orders),
        cashier: "Online",
        mode: "grocery",
        priceType: "retail",
        source: "online",
        orderType: "takeaway",
        customerName: account.name,
        customerMobile: account.mobile,
        customerId: effPay === "udhaar" ? account.studentId?.trim() : undefined,
        identityType: "account",
        placeLabel: `${account.placeType} ${account.placeDetail}`,
        token: proofRequired ? 0 : nextToken(orders, "grocery"),
        lines: gCart.map((l) => ({ itemId: l.item.id, name: `${gLineName(l)}${lineIsOffer(l.item, l.packing) ? " (Offer)" : ""}`, price: gPrice(l), qty: l.qty })),
        subtotal: gTotal,
        discount: 0,
        total: gTotal,
        payment: proofRequired ? "Online" : PAY_MAP[effPay],
        paymentProof: proofRequired ? { method: payMethod, txnId: txnId.trim() || undefined, amount: gTotal, proofImage: proofImg!, uploadedAt: Date.now() } : undefined,
        paymentStatus: proofRequired ? "proof_pending" : undefined,
        udhaarName: effPay === "udhaar" ? `${account.name} (ID: ${account.studentId?.trim()})` : undefined,
        status: "pending", // packing queue: pending → preparing (packing) → ready
        createdAt: new Date().toISOString(),
      };
      saveOrders([order, ...orders]);
      // deduct stock — same stock engine as the grocery counter; per
      // PRODUCT in BASE units (a Full Dabba line removes containsQty packs;
      // the server does the same inside the order transaction)
      const next = loadGrocery().map((it) => {
        const used = gCart.filter((l) => l.item.id === it.id).reduce((s, l) => s + l.qty * (l.packing?.containsQty ?? 1), 0);
        return used ? { ...it, stock: Math.max(0, Math.round((it.stock - used) * 10) / 10) } : it;
      });
      saveGrocery(next); setGItems(next);
      setGCart([]);
      setProofImg(null); setTxnId("");
      setCartOpen(false);
      setTrackId(order.id);
      refreshMine();
      return;
    }
    if (!formOk || !udhaarOk || (cart.length === 0 && dealCart.length === 0)) return;
    try { window.localStorage.setItem("canteen-pos-customer", JSON.stringify({ name: name.trim(), mobile: mobile.trim() })); } catch {}
    const orders = loadOrders();
    const isDineIn = entry === "table" && orderType === "dine-in";
    // Table-QR customers CHOOSE (Talha): 💵 Cash → order goes straight to
    // the Kitchen with its token, marked Cash. 📱 Online Payment → the
    // payment-first proof flow: proof_pending, token 0, NO kitchen yet —
    // the token is assigned when staff confirm the payment.
    const order: Order = {
      id: `ord-${Date.now()}`,
      billNo: nextBillNo(orders),
      cashier: "Online",
      mode: "canteen",
      source: "online",
      orderType: entry === "remote" ? "takeaway" : orderType,
      tableNo: isDineIn ? parseInt(tableNo, 10) : undefined,
      customerName: name.trim(),
      customerMobile: entry === "remote" ? mobile.trim() : undefined,
      customerId: effPay === "udhaar" ? (entry === "remote" ? account?.studentId?.trim() : udhaarId.trim()) : undefined,
      identityType: entry === "table" ? "table" : "account",
      placeLabel: entry === "remote" && account ? `${account.placeType} ${account.placeDetail}` : undefined,
      token: proofRequired ? 0 : nextToken(orders, "canteen"),
      // Menu lines + ONE line per deal (deal price exactly, components
      // attached — the kitchen makes every component from them).
      lines: [
        ...cart.map((l) => ({ itemId: l.item.id, name: l.item.name, price: l.item.price, qty: l.qty })),
        ...dealCart.map((l) => dealOrderLine(l.deal, menu, l.qty)),
      ],
      subtotal: canteenTotal,
      discount: 0,
      total: canteenTotal,
      payment: proofRequired ? "Online" : effPay === "counter" ? "Cash" : PAY_MAP[effPay],
      paymentProof: proofRequired ? { method: payMethod, txnId: txnId.trim() || undefined, amount: canteenTotal, proofImage: proofImg!, uploadedAt: Date.now() } : undefined,
      paymentStatus: proofRequired ? "proof_pending" : undefined,
      udhaarName: effPay === "udhaar" ? `${name.trim()} (ID: ${entry === "remote" ? account?.studentId?.trim() : udhaarId.trim()})` : undefined,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    saveOrders([order, ...orders]);
    // Deduct canteen stock — same single stock state as the counter +
    // Stock screen. Usage = cart lines + deal components × deal qty.
    const usage = new Map<string, number>();
    cart.forEach((l) => usage.set(l.item.id, (usage.get(l.item.id) ?? 0) + l.qty));
    dealCart.forEach((l) => l.deal.items.forEach((di) => usage.set(di.menuItemId, (usage.get(di.menuItemId) ?? 0) + di.qty * l.qty)));
    const nextMenu = loadMenu().map((m) => {
      const used = usage.get(m.id);
      return used ? { ...m, stock: Math.max(0, (m.stock ?? 0) - used) } : m;
    });
    saveMenu(nextMenu); setMenu(nextMenu);
    setCart([]);
    setDealCart([]);
    setProofImg(null); setTxnId("");
    setCartOpen(false);
    setTrackId(order.id);
    refreshMine();
  }

  const trackedSteps = tracked?.mode === "grocery" ? GROCERY_STEPS : STATUS_STEPS;
  const stepIndex = tracked ? trackedSteps.findIndex((s) => s.key === tracked.status) : -1;
  const trackedWhere = tracked
    ? tracked.mode === "grocery" ? `🛒 Grocery — ${tracked.placeLabel || ""} · Pickup at Grocery Counter`
      : tracked.orderType === "dine-in" ? `🍽️ Dine-In — Table ${tracked.tableNo}`
      : tracked.placeLabel ? `🌐 Online — ${tracked.placeLabel} · Pickup`
      : "🥡 Takeaway — Pickup"
    : "";

  // ── BUSINESS SETUP gates (SALE version) ──────────────────────────────
  // Pehli dafa (setupDone=false) customer side par bhi wizard pehle ata
  // hai — setup ke baghair ordering nahi khulti. Table ordering sirf
  // canteen ki hai: canteen setup mein off ho to polite notice.
  if (!mounted) return <div className="min-h-screen" style={{ background: "#0F172A" }} />;
  if (!shop.setupDone) return <SetupScreen />;
  if (entry === "table" && !shop.hasCanteen) return <DisabledSectionNotice what="Table Order (Canteen)" />;

  // ── Closed-shop popup (Talha, 14 Nov 2026) ──────────────────────────────
  // Owner ne shop band kar di (Owner → Settings → Shop Status) to online
  // customers ko ordering ki jagah sirf ye screen milti hai: band hone ki
  // khabar + rabta number (Call / WhatsApp). Koi dismiss nahi — shop khulte
  // hi (ya "Dobara check karein" par) normal ordering wapas aa jati hai.
  if (shop.shopOpen === false) {
    const digits = (shop.closedContactNumber || "").replace(/[^0-9]/g, "");
    const intl = digits.startsWith("92") ? digits : digits.startsWith("0") ? `92${digits.slice(1)}` : digits;
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "#FFF7ED" }}>
        <div className="w-full max-w-md bg-white rounded-3xl border border-orange-100 shadow-xl p-6 text-center pop-in">
          <div className="text-xs font-black tracking-wide text-stone-400">{shop.collegeName || shop.canteenName}</div>
          <h1 className="text-xl font-black mt-0.5">{[shop.hasCanteen ? shop.canteenName : null, retailOn ? shop.groceryName : null].filter(Boolean).join(" · ")}</h1>
          <div className="text-6xl mt-5">🛑</div>
          <div className="text-2xl font-black mt-2" style={{ color: "#DC2626" }}>Abhi band hai</div>
          <p className="text-stone-500 font-bold mt-1">Shop / canteen abhi band hai — online ordering is waqt nahi ho rahi.</p>
          <p className="text-stone-600 font-bold mt-4">Order ke liye is number par rabta karein:</p>
          <div className="text-3xl font-black tracking-wide my-2" dir="ltr">{shop.closedContactNumber}</div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <a href={`tel:+${intl}`} className="rounded-2xl py-3.5 font-black text-white text-lg shadow" style={{ background: "#16A34A" }}>📞 Call karein</a>
            <a href={`https://wa.me/${intl}`} target="_blank" rel="noreferrer" className="rounded-2xl py-3.5 font-black text-white text-lg shadow" style={{ background: "#25D366" }}>💬 WhatsApp</a>
          </div>
          <button onClick={() => window.location.reload()} className="mt-4 rounded-xl px-4 py-2 font-bold border-2 border-stone-200 text-stone-500">🔄 Dobara check karein</button>
        </div>
        <GuidelineButton entry="online" label="📖 Madad / Guideline" variant="floating" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar />
      <div className="px-4 py-1.5 text-xs font-bold text-stone-500 bg-blue-50 flex justify-between">
        <span>📱 {(shop.hasCanteen ? shop.canteenName : shop.groceryName).toUpperCase()} — ONLINE ORDER</span><span>{entry === "table" ? "🍽️ At a table" : entry === "remote" ? "🌐 Online — Account" : "Choose below 👇"}</span>
      </div>

      <main className="flex-1 w-full max-w-2xl mx-auto p-3 pb-28">
        {/* REMOTE AUTH — account is MANDATORY for remote orders (fake-order protection) */}
        {authOpen && !entry && (
          <section className="bg-white rounded-2xl border border-blue-100 shadow-sm p-4 mb-3 pop-in">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-extrabold">🌐 Online Order — {authMode === "login" ? "Login" : "Create Account"}</h2>
              <button onClick={() => setAuthOpen(false)} className="text-xs font-bold text-stone-400">← Back</button>
            </div>
            <p className="text-sm text-stone-500 mb-3">Door se (hostel room / office se) order karne ke liye <b>account lazmi hai</b> — taake fake orders na aayein. Table par beth kar order karne ke liye koi account nahi chahiye.</p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button onClick={() => { setAuthMode("login"); setAuthErr(""); }} className="rounded-xl py-2.5 font-extrabold border-[3px]" style={authMode === "login" ? { background: "#1976D2", borderColor: "#1976D2", color: "#fff" } : { borderColor: "#E7E5E4" }}>Login</button>
              <button onClick={() => { setAuthMode("register"); setAuthErr(""); }} className="rounded-xl py-2.5 font-extrabold border-[3px]" style={authMode === "register" ? { background: "#16A34A", borderColor: "#16A34A", color: "#fff" } : { borderColor: "#E7E5E4" }}>Create Account</button>
            </div>
            {authMode === "login" ? (
              <div className="space-y-2">
                <input value={loginMobile} onChange={(e) => setLoginMobile(e.target.value)} inputMode="tel" placeholder="Mobile Number (login ID)"
                  className="w-full rounded-xl border-2 border-stone-200 px-4 py-3 outline-none focus:border-blue-500" />
                <input value={loginPass} onChange={(e) => setLoginPass(e.target.value)} type="password" placeholder="Password"
                  className="w-full rounded-xl border-2 border-stone-200 px-4 py-3 outline-none focus:border-blue-500" />
                <button onClick={doLogin} className="w-full rounded-2xl py-3.5 font-black text-white text-lg" style={{ background: "#1976D2" }}>Login &amp; Order →</button>
              </div>
            ) : (
              <div className="space-y-2">
                <input value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} placeholder="Full Name *"
                  className="w-full rounded-xl border-2 border-stone-200 px-4 py-3 outline-none focus:border-green-600" />
                <input value={reg.mobile} onChange={(e) => setReg({ ...reg, mobile: e.target.value })} inputMode="tel" placeholder="Mobile Number * — yehi aapka login hoga"
                  className="w-full rounded-xl border-2 border-stone-200 px-4 py-3 outline-none focus:border-green-600" />
                <input value={reg.email} onChange={(e) => setReg({ ...reg, email: e.target.value })} type="email" placeholder="Email Address * — confirmation code isi par ayega"
                  className="w-full rounded-xl border-2 border-stone-200 px-4 py-3 outline-none focus:border-green-600" />
                <input value={reg.password} onChange={(e) => setReg({ ...reg, password: e.target.value })} type="password" placeholder="Password * (kam az kam 4 characters)"
                  className="w-full rounded-xl border-2 border-stone-200 px-4 py-3 outline-none focus:border-green-600" />
                <div className="grid grid-cols-2 gap-2">
                  <select value={reg.placeType} onChange={(e) => setReg({ ...reg, placeType: e.target.value as CustomerAccount["placeType"] })}
                    className="rounded-xl border-2 border-stone-200 px-3 py-3 outline-none focus:border-green-600 bg-white font-bold">
                    <option>Hostel Room</option><option>Office</option><option>Other</option>
                  </select>
                  <input value={reg.placeDetail} onChange={(e) => setReg({ ...reg, placeDetail: e.target.value })} placeholder="Room / Office detail * (e.g. Room 12)"
                    className="rounded-xl border-2 border-stone-200 px-4 py-3 outline-none focus:border-green-600" />
                </div>
                <input value={reg.studentId} onChange={(e) => setReg({ ...reg, studentId: e.target.value })} placeholder="Student/Staff ID — OPTIONAL (sirf Udhaar ke liye)"
                  className="w-full rounded-xl border-2 border-dashed border-amber-300 px-4 py-3 outline-none focus:border-amber-500" />
                <button onClick={doRegister} className="w-full rounded-2xl py-3.5 font-black text-white text-lg" style={{ background: "#16A34A" }}>✓ Create Account &amp; Order →</button>
              </div>
            )}
            {authErr && <p className="mt-2 text-sm font-bold" style={{ color: "#DC2626" }}>{authErr}</p>}
            <p className="mt-3 text-[11px] font-bold rounded-xl bg-amber-50 border border-amber-100 px-3 py-2" style={{ color: "#92400E" }}>
              📧 Account banne ke baad aapke <b>email par 6-digit confirmation code</b> jayega — code confirm hue baghair account active nahi hoga aur order nahi ho sakega. Mobile confirmation optional hai.
            </p>
          </section>
        )}

        {/* STEP 1 — entry chooser */}
        {!entry && !authOpen ? (
          <section className={`grid grid-cols-1 ${shop.hasCanteen ? "sm:grid-cols-2" : ""} gap-3 mb-3`}>
            {shop.hasCanteen && (
              <button onClick={() => chooseEntry("table")} className="tile-3d rounded-3xl p-6 text-left text-white shadow-md" style={{ background: "#16A34A" }}>
                <div className="text-4xl mb-1">🍽️</div>
                <div className="text-xl font-black">I am at a Table</div>
                <div className="text-sm opacity-85">Scanned the table QR — or tap here and pick your table number. <b>Koi account nahi chahiye.</b></div>
              </button>
            )}
            <button onClick={() => chooseEntry("remote")} className="tile-3d rounded-3xl p-6 text-left text-white shadow-md" style={{ background: "#1976D2" }}>
              <div className="text-4xl mb-1">🌐</div>
              <div className="text-xl font-black">Order Online — Hostel / Office</div>
              <div className="text-sm opacity-85">{account ? `👤 Logged in: ${account.name} — tap to order` : "Door se order — is ke liye account lazmi hai. Order now, pick up from the counter."}</div>
            </button>
          </section>
        ) : entry ? (
          <>
            {/* STEP 1+2 — the ONE short form: Name + Table/Mobile, Dine-In/Takeaway */}
            <section className="bg-white rounded-2xl border border-orange-100 shadow-sm p-4 mb-3 pop-in">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-extrabold">{entry === "table" ? "🍽️ Your Table Order" : "🌐 Online Order — Pickup"}</h2>
                <button onClick={() => setEntry(null)} className="text-xs font-bold text-stone-400">Change</button>
              </div>
              {entry === "remote" && account && (
                <div className="flex items-center justify-between gap-2 mb-3 rounded-xl bg-blue-50 border border-blue-100 px-3 py-2">
                  <span className="text-sm font-bold" style={{ color: "#1976D2" }}>👤 {account.name} · {account.placeType} {account.placeDetail} · {account.mobile}{account.studentId ? ` · ID: ${account.studentId}` : ""}</span>
                  <button onClick={doLogout} className="text-xs font-extrabold rounded-lg bg-white border border-blue-200 px-2.5 py-1.5 shrink-0">Logout</button>
                </div>
              )}
              {fromQr && entry === "table" && (
                <p className="text-sm font-bold mb-3 rounded-xl bg-green-50 border border-green-100 px-3 py-2" style={{ color: "#16A34A" }}>
                  📷 Opened from Table {tableNo} QR — table is filled for you, change it if needed.
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your Name *" readOnly={entry === "remote"}
                  className="rounded-xl border-2 border-stone-200 px-4 py-3 outline-none focus:border-orange-500 read-only:bg-stone-50 read-only:text-stone-500" />
                {entry === "table" ? (
                  <input value={tableNo} onChange={(e) => setTableNo(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric"
                    placeholder="Table Number *" disabled={orderType === "takeaway"}
                    className="rounded-xl border-2 border-stone-200 px-4 py-3 outline-none focus:border-orange-500 disabled:opacity-40" />
                ) : (
                  <input value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="tel" placeholder="Mobile Number * — for pickup confirmation" readOnly
                    className="rounded-xl border-2 border-stone-200 px-4 py-3 outline-none focus:border-orange-500 read-only:bg-stone-50 read-only:text-stone-500" />
                )}
              </div>
              {entry === "table" && (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setOrderType("dine-in")} className="rounded-2xl py-4 font-black text-lg border-[3px]"
                    style={orderType === "dine-in" ? { background: "#16A34A", borderColor: "#16A34A", color: "#fff" } : { borderColor: "#E7E5E4", background: "#fff" }}>
                    🍽️ Dine-In
                  </button>
                  <button onClick={() => setOrderType("takeaway")} className="rounded-2xl py-4 font-black text-lg border-[3px]"
                    style={orderType === "takeaway" ? { background: "#F97316", borderColor: "#F97316", color: "#fff" } : { borderColor: "#E7E5E4", background: "#fff" }}>
                    🥡 Takeaway
                  </button>
                </div>
              )}
              {entry === "remote" && <p className="text-sm font-bold text-stone-500">🥡 Takeaway / Pickup at counter — no dine-in from hostel/office.</p>}
              {!formOk && (
                <p className="mt-2 text-sm font-bold" style={{ color: "#DC2626" }}>
                  ⚠️ {tableInvalid
                    ? `Table ${tableNo} maujood nahi hai — hamari tables 1 se ${tableLimit} tak hain. Sahi table number likhein.`
                    : entry === "table"
                      ? "Write your name" + (orderType === "dine-in" ? " and table number" : "") + " to order. No account, no ID needed. 👍"
                      : account && !emailVerified
                        ? "Pehle upar apna email confirmation code confirm karein — us ke baghair order nahi ho sakta."
                        : "Remote order ke liye pehle login / account banayein."}
                </p>
              )}
              {formOk && <p className="mt-2 text-sm font-bold" style={{ color: "#16A34A" }}>✓ Ready, {name.trim()}{entry === "table" && orderType === "dine-in" ? ` — Table ${tableNo}` : ""}. Pick your food below 👇</p>}
            </section>
          </>
        ) : null}

        {/* SHOP CHOICE — remote customers only, right after login: Canteen OR Grocery (one order = one shop) */}
        {entry === "remote" && account && !remoteShop && (
          <section className="mb-3 pop-in">
            <h2 className="font-extrabold mb-2">Kahan se order karna hai? <span className="text-stone-400 font-bold text-sm">(ek order = ek shop — mix nahi hota)</span></h2>
            <div className={`grid grid-cols-1 ${shop.hasCanteen && retailOn ? "sm:grid-cols-2" : ""} gap-3`}>
              {shop.hasCanteen && (
                <button onClick={() => setRemoteShop("canteen")} className="tile-3d rounded-3xl p-6 text-left text-white shadow-md" style={{ background: "#E64A19" }}>
                  <div className="text-4xl mb-1">🍔</div>
                  <div className="text-xl font-black">Canteen Order</div>
                  <div className="text-sm opacity-85">{shop.canteenName} — khana, kitchen token, counter se pickup</div>
                </button>
              )}
              {retailOn && (
                <button onClick={() => setRemoteShop("grocery")} className="tile-3d rounded-3xl p-6 text-left text-white shadow-md" style={{ background: "#388E3C" }}>
                  <div className="text-4xl mb-1">🛒</div>
                  <div className="text-xl font-black">Grocery Order</div>
                  <div className="text-sm opacity-85">{shop.groceryName} — samaan pack ho kar grocery counter se pickup</div>
                </button>
              )}
            </div>
          </section>
        )}
        {entry === "remote" && remoteShop && (
          <div className="flex items-center justify-between mb-3 rounded-2xl px-4 py-2.5 text-white font-extrabold pop-in" style={{ background: remoteShop === "grocery" ? "#388E3C" : "#E64A19" }}>
            <span>{remoteShop === "grocery" ? `🛒 Grocery Order — ${shop.groceryName}` : `🍔 Canteen Order — ${shop.canteenName}`}</span>
            {shop.hasCanteen && retailOn && (
              <button onClick={() => setRemoteShop(null)} className="text-xs font-extrabold rounded-lg bg-white/20 px-2.5 py-1.5">Change Shop</button>
            )}
          </div>
        )}

        {/* ── ACCOUNT CONFIRMATION (email lazmi, mobile optional) ───────
            Email code confirm hue baghair account INACTIVE hai — order
            nahi ho sakta. Delivery state honestly dikhta hai: service
            configure na ho to wazeh likha hai ke code deployment par
            configure hone ke baad ayega (jhoot nahi ke "bhej diya"). */}
        {account && account.emailVerified === false && (
          <section className="rounded-2xl border-2 border-amber-300 bg-amber-50 shadow-sm p-4 mb-3 pop-in" data-testid="verify-panel">
            <h2 className="font-extrabold" style={{ color: "#92400E" }}>📧 Email Confirm Karein — Account Abhi Active Nahi</h2>
            <p className="text-sm font-bold text-stone-600 mt-1">
              Aapke email <b>{account.email}</b> par 6-digit confirmation code bheja gaya hai. Code likh kar Confirm karein — is ke baghair order nahi ho sakta.
            </p>
            {verifyDelivery && verifyDelivery.state !== "sent" && (
              <p className="text-xs font-bold rounded-xl bg-white border border-amber-200 px-3 py-2 mt-2" style={{ color: "#92400E" }} data-testid="verify-delivery-note">
                ℹ️ Abhi shop ke system par email service configure nahi hai — deployment ke waqt email/SMS service lagne par code asal mein bheja jayega. (Test setup mein code server console mein milta hai.)
              </p>
            )}
            <div className="flex gap-2 mt-3">
              <input value={emailCode} onChange={(e) => setEmailCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))} inputMode="numeric" placeholder="6-digit code"
                data-testid="verify-email-input"
                className="flex-1 min-w-0 rounded-xl border-2 border-amber-300 px-4 py-3 text-lg font-black tracking-widest outline-none focus:border-amber-500 bg-white" />
              <button onClick={doVerifyEmail} disabled={emailCode.length !== 6} data-testid="verify-email-btn"
                className="rounded-xl px-5 py-3 font-black text-white disabled:opacity-40" style={{ background: "#16A34A" }}>✓ Confirm</button>
            </div>
            <button onClick={() => doResend("email")} className="mt-2 text-sm font-extrabold underline" style={{ color: "#92400E" }}>📨 Code dobara bhejein (1 minute ke baad)</button>
            {verifyErr && <p className="mt-2 text-sm font-bold" style={{ color: "#DC2626" }}>{verifyErr}</p>}
            {verifyMsg && <p className="mt-2 text-sm font-bold" style={{ color: "#16A34A" }}>{verifyMsg}</p>}
          </section>
        )}
        {account && account.emailVerified !== false && !account.mobileVerified && !mobileSkipped && (
          <section className="rounded-2xl border border-blue-100 bg-blue-50/60 shadow-sm p-4 mb-3 pop-in" data-testid="verify-mobile-panel">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-extrabold" style={{ color: "#1976D2" }}>📱 Mobile Confirm Karein? (Optional)</h2>
                <p className="text-sm font-bold text-stone-600 mt-1">Mobile {account.mobile} par SMS code bhej kar confirm kar sakte hain — ye <b>lazmi nahi</b> hai, order is ke baghair bhi ho jayega.</p>
              </div>
              <button onClick={() => setMobileSkipped(true)} className="text-xs font-extrabold rounded-lg bg-white border border-blue-200 px-2.5 py-1.5 shrink-0">Skip ✕</button>
            </div>
            {!mobileCodeSent ? (
              <button onClick={async () => { await doResend("mobile"); setMobileCodeSent(true); }} className="mt-3 rounded-xl px-4 py-2.5 font-black text-white" style={{ background: "#1976D2" }}>📨 SMS Code Bhejein</button>
            ) : (
              <div className="flex gap-2 mt-3">
                <input value={mobileCode} onChange={(e) => setMobileCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))} inputMode="numeric" placeholder="6-digit code"
                  data-testid="verify-mobile-input"
                  className="flex-1 min-w-0 rounded-xl border-2 border-blue-200 px-4 py-3 text-lg font-black tracking-widest outline-none focus:border-blue-500 bg-white" />
                <button onClick={doVerifyMobile} disabled={mobileCode.length !== 6} data-testid="verify-mobile-btn"
                  className="rounded-xl px-5 py-3 font-black text-white disabled:opacity-40" style={{ background: "#1976D2" }}>✓ Confirm</button>
              </div>
            )}
            {verifyErr && <p className="mt-2 text-sm font-bold" style={{ color: "#DC2626" }}>{verifyErr}</p>}
            {verifyMsg && <p className="mt-2 text-sm font-bold" style={{ color: "#16A34A" }}>{verifyMsg}</p>}
          </section>
        )}

        {/* Live status */}
        {tracked && (
          <section className="rounded-2xl shadow-md p-4 mb-3 text-white pop-in" style={{ background: "#0F172A" }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold tracking-widest text-stone-300">{tracked.orderType === "dine-in" ? `TABLE ${tracked.tableNo}` : tracked.paymentStatus === "proof_pending" ? "PAYMENT PENDING" : tracked.paymentStatus === "rejected" ? "PAYMENT REJECTED" : tracked.mode === "grocery" ? "GROCERY PICKUP TOKEN" : "YOUR TOKEN"}</div>
                <div className="text-6xl font-black leading-none" style={{ color: "#F97316" }}>{tracked.orderType === "dine-in" ? tracked.tableNo : tracked.token > 0 ? tracked.token : "⏳"}</div>
              </div>
              <div className="text-right text-sm">
                <div className="font-bold">{trackedWhere}</div>
                <div>{tracked.lines.map((l) => `${l.name} ×${l.qty}`).join(", ")}</div>
                <div className="font-black mt-1">Rs {tracked.total.toLocaleString()} · {tracked.payment}</div>
                <div className="text-stone-400 text-xs">Bill {tracked.billNo} · {tracked.token > 0 ? `Token ${tracked.token}` : "Token tasdeeq ke baad milega"}</div>
              </div>
            </div>
            {/* Payment-proof status — the order only enters fulfilment
                (token + steps) once the shop confirms the payment. */}
            {tracked.paymentStatus === "proof_pending" && (
              <div className="mt-3 rounded-xl px-3 py-2.5 text-sm font-bold pop-in" style={{ background: "#FFFBEB", color: "#92400E" }}>
                ⏳ <b>Payment Tasdeeq Baqi</b> — aapka order mil gaya hai. Shop aapki payment proof{tracked.paymentProof ? ` (${tracked.paymentProof.method} · Rs ${tracked.paymentProof.amount.toLocaleString()})` : ""} check karke confirm karegi — confirm hote hi order confirm hoga aur token milega.
              </div>
            )}
            {tracked.paymentStatus === "confirmed" && (
              <div className="mt-3 rounded-xl px-3 py-2 text-sm font-bold" style={{ background: "#F0FDF4", color: "#15803D" }}>
                ✅ <b>Payment Confirm</b>{tracked.paymentProof ? ` — Rs ${tracked.paymentProof.amount.toLocaleString()} via ${tracked.paymentProof.method}` : ""}. Aapka order confirm hai.
              </div>
            )}
            {tracked.paymentStatus === "rejected" && (
              <div className="mt-3 rounded-xl px-3 py-3 text-sm pop-in" style={{ background: "#FEF2F2", color: "#991B1B" }}>
                <div className="font-black">❌ Payment Reject Ho Gayi</div>
                <div className="font-bold">Wajah: {tracked.rejectReason || "—"}</div>
                <div className="mt-2 font-bold text-stone-700">Sahi payment karke naya proof upload karein — order dobara tasdeeq ke liye chala jayega:</div>
                <input value={reTxnId} onChange={(e) => setReTxnId(e.target.value)} placeholder="Transaction ID (optional)"
                  className="mt-2 w-full rounded-xl border-2 border-red-200 bg-white px-3 py-2.5 outline-none focus:border-red-400 text-stone-800" />
                <input type="file" accept="image/*" data-testid="reproof-file-input" onChange={onReProofFile}
                  className="mt-2 w-full rounded-xl border-2 border-dashed border-red-300 bg-white px-3 py-2.5 text-sm font-bold text-stone-700" />
                {reProofImg && <img src={reProofImg} alt="Naya payment proof" className="mt-2 w-20 h-20 object-cover rounded-xl border-2 border-red-200" />}
                <button disabled={!reProofImg} onClick={() => reuploadProof(tracked.id)}
                  className="mt-2 w-full rounded-xl py-3 font-black text-white disabled:opacity-40 active:scale-[0.99]" style={{ background: "#DC2626" }}>
                  🔁 Dobara Proof Upload Karein
                </button>
              </div>
            )}
            {(!tracked.paymentStatus || tracked.paymentStatus === "confirmed") && (
            <>
            <div className="flex items-center mt-4">
              {trackedSteps.map((s, i) => (
                <div key={s.key} className="flex-1 flex items-center last:flex-none">
                  <div className="flex flex-col items-center">
                    <span className="w-9 h-9 rounded-full flex items-center justify-center text-base font-black"
                      style={i <= stepIndex ? { background: "#16A34A", color: "#fff" } : { background: "rgba(255,255,255,0.15)", color: "#A8A29E" }}>
                      {i <= stepIndex ? "✓" : i + 1}
                    </span>
                    <span className="text-[11px] font-bold mt-1 whitespace-nowrap" style={{ color: i <= stepIndex ? "#4ADE80" : "#A8A29E" }}>{s.label}</span>
                  </div>
                  {i < trackedSteps.length - 1 && <div className="flex-1 h-1 mx-1 rounded" style={{ background: i < stepIndex ? "#16A34A" : "rgba(255,255,255,0.15)" }} />}
                </div>
              ))}
            </div>
            {tracked.status === "ready" && (
              <p className="mt-3 text-center font-black" style={{ color: "#4ADE80" }}>
                🎉 Ready! {tracked.mode === "grocery" ? `Packed & ready — please pick up from the GROCERY counter — Token ${tracked.token}` : tracked.orderType === "dine-in" ? "Your order is coming to your table." : `Please pick up from the counter — Token ${tracked.token}`}
              </p>
            )}
            </>
            )}
          </section>
        )}

        {/* My Orders — logged-in remote customers see their own orders + live status */}
        {account && myRemoteOrders.length > 0 && (
          <section className="bg-white rounded-2xl border border-blue-100 shadow-sm p-4 mb-3">
            <h2 className="font-extrabold mb-2">📦 My Orders — {account.name}</h2>
            <div className="space-y-2">
              {myRemoteOrders.map((o) => (
                <button key={o.id} onClick={() => setTrackId(o.id)}
                  className="w-full flex items-center gap-3 rounded-xl border-2 border-stone-100 hover:border-blue-200 px-3 py-2 text-left">
                  <span className="text-2xl font-black" style={{ color: "#F97316" }}>{o.token > 0 ? o.token : "⏳"}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-bold text-sm leading-snug">{o.lines.map((l) => `${l.name} ×${l.qty}`).join(", ")}</span>
                    <span className="block text-xs text-stone-500">{o.mode === "grocery" ? "🛒 Grocery" : "🍔 Canteen"} · {o.placeLabel} · Rs {o.total.toLocaleString()} · {o.payment}</span>
                    {o.paymentStatus === "rejected" && o.rejectReason && <span className="block text-xs font-bold" style={{ color: "#DC2626" }}>Reject wajah: {o.rejectReason} — upar order khol kar dobara proof upload karein</span>}
                  </span>
                  <span className="flex flex-col items-end gap-1 shrink-0">
                    {o.paymentStatus === "proof_pending" && <span className="text-[10px] font-black rounded-full px-2 py-1 text-white" style={{ background: "#D97706" }}>⏳ TASDEEQ BAQI</span>}
                    {o.paymentStatus === "rejected" && <span className="text-[10px] font-black rounded-full px-2 py-1 text-white" style={{ background: "#DC2626" }}>❌ PAYMENT REJECT</span>}
                    {o.paymentStatus === "confirmed" && <span className="text-[10px] font-black rounded-full px-2 py-1 text-white" style={{ background: "#16A34A" }}>✅ PAYMENT CONFIRM</span>}
                    {o.paymentStatus !== "proof_pending" && o.paymentStatus !== "rejected" && (
                      <span className="text-[10px] font-black rounded-full px-2 py-1 text-white" style={{ background: o.status === "ready" ? "#16A34A" : o.status === "preparing" ? "#F59E0B" : "#0F172A" }}>
                        {o.mode === "grocery"
                          ? o.status === "ready" ? "✅ READY — PICKUP" : o.status === "preparing" ? "📦 PACKING" : "📥 RECEIVED"
                          : o.status === "ready" ? "✅ READY" : o.status === "preparing" ? "🍳 PREPARING" : "📥 RECEIVED"}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* 🎁 Deals — active deals only; same deal price the counter charges */}
        {(entry === "table" || (entry === "remote" && remoteShop === "canteen")) && activeDeals.length > 0 && (
          <section className="mb-3" data-testid="online-deals">
            <h2 className="font-extrabold mb-2">🎁 Aaj ki Deals <span className="text-stone-400 font-bold text-sm">(combo — alag alag lene se sasta)</span></h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {activeDeals.map((deal) => {
                const value = dealValue(deal, menu);
                const inCart = dealCart.find((l) => l.deal.id === deal.id)?.qty;
                return (
                  <div key={deal.id} className="pic-3d relative rounded-2xl p-3 shadow-sm border-2 bg-white" data-testid="online-deal-card" data-name={deal.name}
                    style={{ borderColor: inCart ? "#DC2626" : "#FECACA" }}>
                    <div className="flex items-start gap-2">
                      <span className="text-4xl">🎁</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-black leading-tight">{deal.name}</div>
                        <div className="mt-1 flex items-baseline gap-2 flex-wrap">
                          <span className="font-extrabold text-lg" style={{ color: "#DC2626" }}>Rs {deal.price}</span>
                          {value > deal.price && <s className="text-sm font-bold text-stone-400">Rs {value}</s>}
                          {value > deal.price && <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full text-white" style={{ background: "#16A34A" }}>BACHAT Rs {value - deal.price}</span>}
                        </div>
                      </div>
                    </div>
                    {/* Deal ke ANDAR ki cheezein — pic + poora naam + ×qty */}
                    <DealContentsRows deal={deal} menu={menu} thumb={36} />
                    {inCart ? (
                      <div className="mt-2 flex items-center justify-between rounded-xl px-1.5 py-1 bg-red-50">
                        <button onClick={() => chDealQty(deal.id, -1)} className="w-9 h-9 rounded-full bg-white shadow font-black text-lg" aria-label="Decrease quantity">−</button>
                        <span className="font-black">{inCart} in cart</span>
                        <button onClick={() => addDeal(deal)} className="w-9 h-9 rounded-full text-white shadow font-black text-lg" style={{ background: "#DC2626" }} aria-label="Increase quantity">+</button>
                      </div>
                    ) : (
                      <button onClick={() => addDeal(deal)} className="mt-2 w-full rounded-xl py-2.5 font-extrabold text-white active:scale-[0.98] transition" style={{ background: "#DC2626" }}>
                        ＋ Deal Add Karein
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── CANTEEN menu (table flow, or remote after choosing Canteen) — SAME data as the cashier screen ── */}
        {(entry === "table" || (entry === "remote" && remoteShop === "canteen")) && (
          <>
            <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
              {(["All", ...CATEGORIES] as const).map((c) => {
                const active = cat === c;
                const color = c === "All" ? "#F97316" : CATEGORY_STYLE[c].chip;
                return (
                  <button key={c} onClick={() => setCat(c)} className="rounded-full px-4 py-2 font-bold border-2 whitespace-nowrap"
                    style={active ? { background: color, borderColor: color, color: "#fff" } : { background: "#fff", borderColor: "#E7E5E4" }}>{c}</button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {visible.map((item) => {
                const st = CATEGORY_STYLE[item.category];
                const inCart = cart.find((l) => l.item.id === item.id)?.qty;
                return (
                  <div key={item.id} className="pic-3d relative rounded-2xl p-3 shadow-sm border-2 bg-white"
                    style={{ borderColor: inCart ? st.ring : "#F1E9DC" }}>
                    <button onClick={() => add(item)} className="block w-full text-left" aria-label={`Add ${item.name} to cart`}>
                      <div className="pic-plate rounded-xl h-24 flex items-center justify-center mb-2" style={{ background: `linear-gradient(150deg, ${st.bg}, #FFFFFF)` }}>
                        {item.image
                          ? <img src={item.image} alt={item.name} className="pic-art max-h-20 object-contain" />
                          : <span className="pic-art text-6xl">{item.emoji}</span>}
                      </div>
                      <div className="font-bold leading-tight text-sm">{item.name}</div>
                      <div className="font-extrabold" style={{ color: st.chip }}>Rs {item.price}</div>
                    </button>
                    {inCart ? (
                      <div className="mt-2 flex items-center justify-between rounded-xl px-1.5 py-1" style={{ background: st.bg }}>
                        <button onClick={() => chQty(item.id, -1)} className="w-9 h-9 rounded-full bg-white shadow font-black text-lg" aria-label="Decrease quantity">−</button>
                        <span className="font-black">{inCart} in cart</span>
                        <button onClick={() => add(item)} className="w-9 h-9 rounded-full text-white shadow font-black text-lg" style={{ background: "#F97316" }} aria-label="Increase quantity">+</button>
                      </div>
                    ) : (
                      <button onClick={() => add(item)} className="mt-2 w-full rounded-xl py-2.5 font-extrabold text-white active:scale-[0.98] transition" style={{ background: "#F97316" }}>
                        ＋ Add to Cart
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── GROCERY products (remote only, after choosing Grocery) — SAME data as the Grocery POS tab ── */}
        {entry === "remote" && remoteShop === "grocery" && (
          <>
            <input value={gSearch} onChange={(e) => setGSearch(e.target.value)} placeholder="🔍 Search grocery item…"
              className="w-full rounded-xl border-2 border-stone-200 bg-white px-4 py-3 mb-3 outline-none focus:border-green-600" />
            {/* Head chips (row 1) + sub-head chips (row 2) — same two-row
                filter as the Grocery POS tab; only heads/subs that HAVE
                products get a chip */}
            <div className="flex gap-2 mb-2 overflow-x-auto pb-1" data-testid="online-head-chips">
              <button onClick={() => { setGHead("all"); setGSub("all"); }}
                className="rounded-full px-4 py-2 font-bold border-2 whitespace-nowrap"
                style={gHead === "all" ? { background: "#388E3C", borderColor: "#388E3C", color: "#fff" } : { background: "#fff", borderColor: "#E7E5E4" }}>
                🛒 Sab (All) ({gItems.length})
              </button>
              {gHeads.filter((h) => gHeadCount(h.id) > 0).map((h) => {
                const active = gHead === h.id;
                return (
                  <button key={h.id} onClick={() => { setGHead(h.id); setGSub("all"); }}
                    className="rounded-full px-4 py-2 font-bold border-2 whitespace-nowrap"
                    style={active ? { background: "#388E3C", borderColor: "#388E3C", color: "#fff" } : { background: h.tint, borderColor: "#E7E5E4" }}>
                    {h.emoji} {h.name} ({gHeadCount(h.id)})
                  </button>
                );
              })}
            </div>
            {gHead !== "all" && (
              <div className="flex gap-2 mb-3 overflow-x-auto pb-1" data-testid="online-sub-chips">
                <button onClick={() => setGSub("all")}
                  className="rounded-full px-3.5 py-1.5 font-bold border-2 whitespace-nowrap text-sm"
                  style={gSub === "all" ? { background: "#1B5E20", borderColor: "#1B5E20", color: "#fff" } : { background: "#fff", borderColor: "#E7E5E4" }}>
                  All ({gHeadCount(gHead)})
                </button>
                {gSubs.filter((s) => s.headId === gHead && gSubCount(s.id) > 0).map((s) => {
                  const active = gSub === s.id;
                  return (
                    <button key={s.id} onClick={() => setGSub(s.id)}
                      className="rounded-full px-3.5 py-1.5 font-bold border-2 whitespace-nowrap text-sm"
                      style={active ? { background: "#1B5E20", borderColor: "#1B5E20", color: "#fff" } : { background: "#fff", borderColor: "#E7E5E4" }}>
                      {s.name} ({gSubCount(s.id)})
                    </button>
                  );
                })}
              </div>
            )}
            {gSearching && (
              <p className="text-sm font-bold mb-3 rounded-xl bg-green-50 border border-green-100 px-3 py-2" style={{ color: "#388E3C" }}>
                🔍 Search results — saare heads se ({gVisible.length} item{gVisible.length === 1 ? "" : "s"} mile)
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              {gVisible.map((item) => {
                const hasPackings = !!(item.packings && item.packings.length);
                const inCart = hasPackings ? undefined : gCart.find((l) => l.item.id === item.id && !l.packing)?.qty;
                const totalQty = hasPackings ? gCart.filter((l) => l.item.id === item.id).reduce((s, l) => s + l.qty, 0) : 0;
                const step = gStep(item);
                const minPacking = hasPackings ? Math.min(...item.packings!.map((p) => effectivePackingRetail(item, p))) : 0;
                return (
                  <div key={item.id} className="pic-3d relative rounded-2xl p-3 shadow-sm border-2 bg-white"
                    style={{ borderColor: inCart || totalQty > 0 ? "#388E3C" : "#F1E9DC" }}>
                    <button onClick={() => gAdd(item)} className="block w-full text-left" aria-label={`Add ${item.name} to cart`}>
                      <div className="pic-plate rounded-xl h-24 flex items-center justify-center mb-2 overflow-hidden" style={{ background: "linear-gradient(150deg, #F0FDF4, #FFFFFF)" }}>
                        {(() => { const img = groceryImage(item, gHeads, gSubs); return img
                          ? <img src={img} alt={item.name} loading="lazy" className="pic-art w-full h-full object-cover" />
                          : <span className="pic-art text-6xl">{item.emoji}</span>; })()}
                      </div>
                      <div className="font-bold leading-tight text-sm">{item.name}</div>
                      <div className="font-extrabold" style={{ color: "#388E3C" }}>{hasPackings ? <>Rs {minPacking} <span className="text-[11px] text-stone-400">se start</span></> : offerActive(item) ? <><s className="text-stone-400 font-bold">Rs {item.retailPrice}</s> Rs {item.offerPrice}{item.unit === "kg" ? " /kg" : ""}</> : <>Rs {item.retailPrice}{item.unit === "kg" ? " /kg" : ""}</>}</div>
                      {offerActive(item) && <span className="inline-block mt-1 text-[10px] font-black px-1.5 py-0.5 rounded-full text-white" style={{ background: "#DC2626" }}>🎉 Offer{offerPackingOf(item) ? ` · ${offerPackingOf(item)!.label} Rs ${item.offerPrice}` : ""}</span>}
                      <div className="text-[11px] font-bold text-stone-400">Stock: {item.stock}{item.unit === "kg" ? " kg" : ""} · SKU {item.sku}</div>
                      {hasPackings && <div className="text-[11px] font-bold mt-0.5" style={{ color: "#1B5E20" }}>📦 {item.packings!.map((p) => p.label).join(" · ")}</div>}
                    </button>
                    {hasPackings ? (
                      <>
                        {totalQty > 0 && <span className="absolute top-2 right-2 text-white text-xs font-extrabold rounded-full min-w-6 h-6 px-1 flex items-center justify-center" style={{ background: "#388E3C" }}>{totalQty}</span>}
                        <button onClick={() => gAdd(item)} className="mt-2 w-full rounded-xl py-2.5 font-extrabold text-white active:scale-[0.98] transition" style={{ background: "#388E3C" }}>
                          ＋ Packing Chunein
                        </button>
                        {totalQty > 0 && <div className="text-center text-[11px] font-bold text-stone-400 mt-1">{totalQty} packing cart mein — qty cart se badlein</div>}
                      </>
                    ) : inCart ? (
                      <div className="mt-2 flex items-center justify-between rounded-xl px-1.5 py-1 bg-green-50">
                        <button onClick={() => gChQty(gLineKey({ item }), -1)} className="w-9 h-9 rounded-full bg-white shadow font-black text-lg" aria-label="Decrease quantity">−</button>
                        <span className="font-black">{inCart}{item.unit === "kg" ? " kg" : ""}</span>
                        <button onClick={() => gAdd(item)} className="w-9 h-9 rounded-full text-white shadow font-black text-lg" style={{ background: "#388E3C" }} aria-label="Increase quantity">+</button>
                      </div>
                    ) : (
                      <button onClick={() => gAdd(item)} className="mt-2 w-full rounded-xl py-2.5 font-extrabold text-white active:scale-[0.98] transition" style={{ background: "#388E3C" }}>
                        ＋ Add to Cart{item.unit === "kg" ? ` (${step} kg)` : ""}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {gVisible.length === 0 && <p className="text-center text-stone-400 py-6 font-bold">No grocery item matches your search.</p>}
          </>
        )}
        {entry === "table" && <p className="text-center text-xs text-stone-400 mt-4">Table ordering is canteen only — grocery counter se milega. 🙂</p>}
      </main>

      {/* Sticky cart bar */}
      <div className="fixed bottom-0 inset-x-0 z-40 no-print">
        <div className="max-w-2xl mx-auto p-3">
          <button disabled={activeCount === 0} onClick={() => setCartOpen(true)}
            className="w-full rounded-2xl py-4 px-5 text-white font-black text-lg shadow-xl flex justify-between items-center disabled:opacity-50"
            style={{ background: groceryActive ? "#388E3C" : "#F97316" }}>
            <span className="flex items-center gap-2">
              🛒 View Cart / Order
              {activeCount > 0 && <span key={activeCount} className="pop-in inline-flex items-center justify-center min-w-7 h-7 px-1.5 rounded-full bg-white font-black" style={{ color: groceryActive ? "#388E3C" : "#F97316" }}>{activeCount}</span>}
            </span>
            <span>Rs {activeTotal.toLocaleString()}</span>
          </button>
        </div>
      </div>

      {/* Grocery variant → packing chooser — flavour = variant of the
          master, size = packing of the variant (retail prices) */}
      {gChooserItem && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-3" role="dialog" aria-label="Choose variant and packing">
          <div className="bg-white rounded-3xl w-full max-w-md p-5 pop-in">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xl font-extrabold">{gChooserItem.emoji} {gChooserItem.name}</h3>
              <button onClick={() => { setGChooserItem(null); setGChooserVariant(null); }} className="text-2xl font-bold text-stone-400">✕</button>
            </div>
            {gChooserVariant === null ? (
              <>
                <p className="text-sm text-stone-500 font-bold mb-3">Flavour / type chunein — ye isi product ka variant hai.</p>
                <div className="space-y-2">
                  {(gChooserItem.variants ?? []).filter((v) => v.name !== "Standard").map((v) => (
                    <button key={v.name} onClick={() => { if (v.packings.length) setGChooserVariant(v.name); else gAddVariant(gChooserItem, v.name); }}
                      className="w-full flex items-center justify-between rounded-2xl border-[3px] border-stone-200 hover:border-green-500 px-4 py-3.5 text-left active:scale-[0.99] transition">
                      <span className="font-black text-lg">🎨 {v.name}</span>
                      <span className="text-sm font-bold text-stone-400">{v.packings.length ? `${v.packings.length} packings →` : "Add karein →"}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-stone-500 font-bold mb-3">
                  <button onClick={() => setGChooserVariant(null)} className="mr-2 font-black" style={{ color: "#388E3C" }}>← Variants</button>
                  Packing chunein{gChooserVariant !== "Standard" ? ` — ${gChooserVariant}` : ""} — size isi product ki packing hai, alag item nahi.
                </p>
                <div className="space-y-2">
                  {(gChooserVariant === "Standard"
                    ? (gChooserItem.packings ?? [])
                    : (gChooserItem.variants ?? []).find((v) => v.name === gChooserVariant)?.packings ?? []
                  ).map((p) => (
                    <button key={p.label} onClick={() => gAddPacking(gChooserItem, p, gChooserVariant === "Standard" ? undefined : gChooserVariant)}
                      className="w-full flex items-center justify-between rounded-2xl border-[3px] border-stone-200 hover:border-green-500 px-4 py-3.5 text-left active:scale-[0.99] transition">
                      <span className="font-black text-lg">📦 {p.label}</span>
                      {lineIsOffer(gChooserItem, p) ? (
                        <span className="font-black text-lg whitespace-nowrap" style={{ color: "#388E3C" }}>
                          <s className="text-stone-400 font-bold text-base">Rs {p.retailPrice}</s> Rs {gChooserItem.offerPrice} <span className="text-[10px] px-1.5 py-0.5 rounded-full text-white align-middle" style={{ background: "#DC2626" }}>🎉 Offer</span>
                        </span>
                      ) : (
                        <span className="font-black text-lg" style={{ color: "#388E3C" }}>Rs {p.retailPrice}</span>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Cart sheet */}
      {cartOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-3">
          <div className="bg-white rounded-3xl w-full max-w-lg p-5 max-h-[92vh] overflow-y-auto pop-in">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-xl font-extrabold">🛒 Your Cart {groceryActive ? "— Grocery" : "— Canteen"} <span className="text-sm text-stone-400 font-bold">(one order, one token)</span></h3>
              <button onClick={() => setCartOpen(false)} className="text-2xl font-bold text-stone-400">✕</button>
            </div>
            {!groceryActive && cart.length === 0 && dealCart.length === 0 && <p className="text-stone-400 text-center py-6">Cart is empty.</p>}
            {groceryActive && gCart.length === 0 && <p className="text-stone-400 text-center py-6">Cart is empty.</p>}
            <div className="space-y-2 mb-3">
              {!groceryActive && cart.map((l) => (
                <div key={l.item.id} className="flex items-center gap-2 rounded-xl bg-orange-50/60 border border-orange-100 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm leading-tight">{l.item.emoji} {l.item.name}</div>
                    <div className="text-xs text-stone-500">Rs {l.item.price} × {l.qty} = <b>Rs {l.item.price * l.qty}</b></div>
                  </div>
                  <button onClick={() => chQty(l.item.id, -1)} className="w-9 h-9 rounded-full bg-white border-2 border-stone-200 font-extrabold">−</button>
                  <span className="w-6 text-center font-extrabold">{l.qty}</span>
                  <button onClick={() => chQty(l.item.id, 1)} className="w-9 h-9 rounded-full bg-white border-2 border-stone-200 font-extrabold">+</button>
                  <button onClick={() => setCart((c) => c.filter((x) => x.item.id !== l.item.id))} className="text-lg" aria-label={`Remove ${l.item.name}`}>🗑️</button>
                </div>
              ))}
              {!groceryActive && dealCart.map((l) => (
                <div key={l.deal.id} className="flex items-center gap-2 rounded-xl bg-red-50/70 border border-red-200 px-3 py-2" data-testid="cart-deal-line">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm leading-tight">🎁 {l.deal.name}</div>
                    <div className="text-xs text-stone-500 leading-snug">{dealContentsText(l.deal, menu)}</div>
                    <div className="text-xs text-stone-500">Rs {l.deal.price} × {l.qty} = <b>Rs {l.deal.price * l.qty}</b></div>
                  </div>
                  <button onClick={() => chDealQty(l.deal.id, -1)} className="w-9 h-9 rounded-full bg-white border-2 border-stone-200 font-extrabold">−</button>
                  <span className="w-6 text-center font-extrabold">{l.qty}</span>
                  <button onClick={() => chDealQty(l.deal.id, 1)} className="w-9 h-9 rounded-full bg-white border-2 border-stone-200 font-extrabold">+</button>
                  <button onClick={() => setDealCart((c) => c.filter((x) => x.deal.id !== l.deal.id))} className="text-lg" aria-label={`Remove ${l.deal.name}`}>🗑️</button>
                </div>
              ))}
              {groceryActive && gCart.map((l) => {
                const key = gLineKey(l);
                const price = gPrice(l);
                return (
                <div key={key} className="flex items-center gap-2 rounded-xl bg-green-50/70 border border-green-100 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm leading-tight">{l.item.emoji} {gLineName(l)}</div>
                    <div className="text-xs text-stone-500">Rs {price} × {l.qty}{l.item.unit === "kg" ? " kg" : ""} = <b>Rs {Math.round(price * l.qty)}</b></div>
                  </div>
                  <button onClick={() => gChQty(key, -1)} className="w-9 h-9 rounded-full bg-white border-2 border-stone-200 font-extrabold">−</button>
                  <span className="w-10 text-center font-extrabold">{l.qty}{l.item.unit === "kg" ? "kg" : ""}</span>
                  <button onClick={() => gChQty(key, 1)} className="w-9 h-9 rounded-full bg-white border-2 border-stone-200 font-extrabold">+</button>
                  <button onClick={() => setGCart((c) => c.filter((x) => gLineKey(x) !== key))} className="text-lg" aria-label={`Remove ${l.item.name}`}>🗑️</button>
                </div>
                );
              })}
            </div>
            <div className="flex justify-between items-center py-2 mb-3" style={{ borderTop: "4px double #0F172A", borderBottom: "4px double #0F172A" }}>
              <span className="font-black">TOTAL</span>
              <span className="text-2xl font-black" style={{ color: "#F97316" }}>Rs {activeTotal.toLocaleString()}</span>
            </div>

            <div className="font-extrabold mb-2">Payment:</div>
            {/* TABLE-QR customers CHOOSE (choice is the customer's): Cash =
                order straight to the Kitchen, token at once; Online Payment
                = payment-first proof flow, token after staff tasdeeq.
                REMOTE customers get no cash option — they are not present. */}
            {entry === "table" && (
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button onClick={() => setPay("counter")} data-testid="pay-cash-card"
                  className="rounded-2xl border-[3px] px-3 py-3.5 text-left transition active:scale-[0.99]"
                  style={effPay === "counter" ? { borderColor: "#16A34A", background: "#F0FDF4" } : { borderColor: "#E7E5E4", background: "#fff" }}>
                  <div className="font-black text-lg">💵 Cash {effPay === "counter" && "✓"}</div>
                  <div className="text-xs font-bold text-stone-500">Order foran Kitchen jayega, token abhi milega — payment counter / table par de dein.</div>
                </button>
                <button onClick={() => setPay("online")} data-testid="pay-online-card"
                  className="rounded-2xl border-[3px] px-3 py-3.5 text-left transition active:scale-[0.99]"
                  style={effPay === "online" ? { borderColor: "#1976D2", background: "#EFF6FF" } : { borderColor: "#E7E5E4", background: "#fff" }}>
                  <div className="font-black text-lg">📱 Online Payment {effPay === "online" && "✓"}</div>
                  <div className="text-xs font-bold text-stone-500">Pehle payment + proof upload — shop tasdeeq karegi, phir order confirm hoga aur token milega.</div>
                </button>
              </div>
            )}
            <div className="space-y-2 mb-4">
              {entry === "remote" && (
                <button onClick={() => setPay("online")} className="w-full rounded-xl border-[3px] px-4 py-3 text-left font-bold" style={effPay === "online" ? { borderColor: "#16A34A", background: "#F0FDF4" } : { borderColor: "#E7E5E4" }}>
                  📱 Online Payment — pehle pay karein, proof upload karein {effPay === "online" && "✓"}
                  <span className="block text-xs font-bold text-stone-500">Remote order payment ke baghair confirm nahi hota — shop pehle proof ki tasdeeq karegi.</span>
                </button>
              )}
              {entry === "table" && effPay === "counter" && (
                <p className="rounded-xl bg-green-50 border border-green-100 px-4 py-3 text-sm font-bold pop-in" style={{ color: "#15803D" }}>
                  💵 Cash select hai — Place Order dabate hi order Kitchen chala jayega aur token mil jayega. Payment counter / table par de dein.
                </p>
              )}
              {proofRequired && (
                <div className="rounded-xl border-2 border-green-200 bg-green-50/60 p-3 pop-in" data-testid="payment-step">
                  <div className="font-black text-sm mb-1">Step 1 — Payment karein: <span style={{ color: "#16A34A" }}>Rs {activeTotal.toLocaleString()}</span></div>
                  <div className="grid grid-cols-4 gap-1.5 mb-2">
                    {(["JazzCash", "Easypaisa", "Raast", "Bank"] as ProofPaymentMethod[]).map((m) => (
                      <button key={m} onClick={() => setPayMethod(m)} className="rounded-lg py-2 text-sm font-extrabold border-2 transition active:scale-[0.98]"
                        style={payMethod === m ? { background: "#16A34A", borderColor: "#16A34A", color: "#fff" } : { background: "#fff", borderColor: "#E7E5E4" }}>{m}</button>
                    ))}
                  </div>
                  <div className="rounded-lg bg-white border border-green-100 px-3 py-2 text-center mb-2">
                    <div className="text-[11px] font-bold text-stone-400">{payMethod.toUpperCase()} — IS NUMBER PAR PAYMENT BHEJEIN</div>
                    <div className="font-black text-lg tracking-wide break-all">{payNumber}</div>
                    <span className="text-[10px] font-bold rounded-full px-2 py-0.5" style={{ background: "#FEF3C7", color: "#92400E" }}>Demo number — asal number Owner → Shop Settings se set hoga</span>
                  </div>
                  {qrProviders[payMethod.toLowerCase()] && (
                    <div className="rounded-lg bg-white border border-green-100 px-3 py-3 text-center mb-2" data-testid="merchant-qr">
                      <img src={`/api/v1/public/merchant-qr/${payMethod.toLowerCase()}`} alt={`${payMethod} QR code`}
                        className="w-52 h-52 object-contain mx-auto rounded-lg border border-stone-200" />
                      <div className="font-black text-sm mt-2">📷 Is QR ko scan karke payment karein — phir screenshot lazmi upload karein</div>
                    </div>
                  )}
                  <input value={txnId} onChange={(e) => setTxnId(e.target.value)} placeholder="Transaction ID (optional) — payment app se milta hai"
                    className="w-full rounded-xl border-2 border-stone-200 bg-white px-3 py-2.5 outline-none focus:border-green-600" />
                  <div className="font-black text-sm mt-3 mb-1">Step 2 — Payment ka screenshot (proof) upload karein *</div>
                  <input type="file" accept="image/*" data-testid="proof-file-input" onChange={onProofFile}
                    className="w-full rounded-xl border-2 border-dashed border-green-400 bg-white px-3 py-2.5 text-sm font-bold" />
                  {proofImg ? (
                    <div className="mt-2 flex items-start gap-2">
                      <img src={proofImg} alt="Payment proof preview" data-testid="proof-preview" className="w-24 h-24 object-cover rounded-xl border-2 border-green-200" />
                      <div>
                        <div className="text-sm font-bold" style={{ color: "#16A34A" }}>✓ Proof attach ho gaya</div>
                        <button onClick={() => setProofImg(null)} className="mt-1 text-xs font-extrabold rounded-lg bg-white border border-red-200 px-2.5 py-1.5" style={{ color: "#DC2626" }}>🗑️ Remove / Badlein</button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs font-bold mt-1.5" style={{ color: "#DC2626" }}>⚠️ Baghair proof ke order place nahi hoga — pehle payment karke screenshot upload karein.</p>
                  )}
                  <p className="text-[11px] font-bold text-stone-500 mt-2">Order place karne ke baad shop aapki payment ki <b>tasdeeq</b> karegi — tasdeeq ke baad hi order confirm hoga aur token milega.</p>
                </div>
              )}
              <button onClick={() => setPay("udhaar")} className="w-full rounded-xl border-[3px] px-4 py-3 text-left font-bold" style={pay === "udhaar" ? { borderColor: "#F59E0B", background: "#FFFBEB" } : { borderColor: "#E7E5E4" }}>
                📒 Udhaar — Shop ke Khata mein {pay === "udhaar" && "✓"}
              </button>
              {pay === "udhaar" && entry === "remote" && (
                <div className="pop-in rounded-xl border-2 border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold">
                  {account?.studentId
                    ? <>✓ Udhaar aapke account ki ID <b>{account.studentId}</b> par shop ke khata mein lagega.</>
                    : <>⚠️ Aapke account mein koi ID nahi hai — <b>Udhaar ke liye account mein ID hona lazmi hai</b>. Online Payment choose karein.</>}
                </div>
              )}
              {pay === "udhaar" && entry !== "remote" && (
                <div className="pop-in">
                  <label className="font-bold block mb-1 text-sm">Udhaar ke liye ID likhein * <span className="text-stone-400 font-semibold">(Student/Staff ID — sirf udhaar ke liye)</span></label>
                  <input value={udhaarId} onChange={(e) => setUdhaarId(e.target.value)} placeholder="e.g. STU-1024"
                    className="w-full rounded-xl border-2 border-amber-300 px-4 py-3 outline-none focus:border-amber-500" />
                </div>
              )}
            </div>

            {!formOk && <p className="text-sm font-bold mb-2" style={{ color: "#DC2626" }}>⚠️ {tableInvalid ? `Table ${tableNo} maujood nahi hai — hamari tables 1 se ${tableLimit} tak hain. Sahi table number likhein.` : entry === "remote" ? "Remote order ke liye account lazmi hai — pehle login karein." : <>Pehle upar apna naam{entry === "table" && orderType === "dine-in" ? " aur table number" : ""} likhein.</>}</p>}
            {pay === "udhaar" && !udhaarOk && <p className="text-sm font-bold mb-2" style={{ color: "#DC2626" }}>⚠️ {entry === "remote" ? "Udhaar ke liye account mein ID hona lazmi hai — doosri payment choose karein." : "Udhaar ke liye ID lazmi hai — upar ID likhein, ya doosri payment choose karein."}</p>}
            {proofRequired && !proofImg && <p className="text-sm font-bold mb-2" style={{ color: "#DC2626" }}>⚠️ Online Payment mein pehle payment karke proof (screenshot) upload karein — tab hi Place Order chalega.</p>}
            <button disabled={!formOk || !udhaarOk || activeCount === 0 || (proofRequired && !proofImg)} onClick={placeOrder}
              className="w-full rounded-2xl py-4 text-xl font-black text-white disabled:opacity-40" style={{ background: "#16A34A" }}>
              ✓ Place Order {proofRequired ? "— Payment Tasdeeq Ke Liye Bhejein" : groceryActive ? "— Pickup at Grocery Counter" : entry === "table" && orderType === "dine-in" ? `— Table ${tableNo || "?"}` : "— Pickup at Counter"}
            </button>
          </div>
        </div>
      )}
      {/* Customer payment toast — visual only (sound stays OFF for
          customers): fires when their proof gets confirmed / rejected
          while they are watching this page. */}
      {payToast && (
        <div className="fixed bottom-24 inset-x-0 z-40 flex justify-center px-3 pointer-events-none">
          <div className="pointer-events-auto max-w-md w-full rounded-2xl shadow-2xl px-4 py-3 text-white font-bold flex gap-2 items-start pop-in" style={{ background: payToast.ok ? "#16A34A" : "#DC2626" }} data-testid="pay-toast">
            <span className="flex-1 text-sm">{payToast.text}</span>
            <button onClick={() => setPayToast(null)} className="font-black" aria-label="Close notification">✕</button>
          </div>
        </div>
      )}
      <GuidelineButton entry="online" label="📖 Madad / Guideline" variant="floating" />
      {/* 🤖 AI Assistant — floating button for customers (staff use the TopBar button) */}
      <AIAssistant variant="floating" />
    </div>
  );
}
