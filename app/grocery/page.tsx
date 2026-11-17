"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import TopBar from "@/components/TopBar";
import StaffGate from "@/components/StaffGate";
import { RetailOnly } from "@/components/BusinessGate";
import OrderAlerts from "@/components/OrderAlerts";
import ScannerTest from "@/components/ScannerTest";
import Receipt, { paymentPayload } from "@/components/Receipt";
import QRCode from "react-qr-code";
import {
  GroceryItem, GroceryHead, GrocerySubHead, GroceryVariant, PackingOption, Order, PaymentMethod,
  loadGrocery, saveGrocery, loadGroceryHeads, loadGrocerySubHeads, groceryImage, loadOrders, saveOrders, nextToken, nextBillNo, isToday, isPaymentCleared, getStaffSessionMember, useShop,
  offerActive, effectiveRetail, effectivePackingRetail, lineIsOffer,
} from "@/lib/store";

// A cart line is one product — in one VARIANT (flavour/type) and/or one
// PACKING (size) of it. The line key (product + variant + packing label) is
// the identity: the same product in two packings is two lines; stock still
// decrements per product (in base units).
interface CartLine { item: GroceryItem; qty: number; price: number; packing?: PackingOption; variant?: string; }
const lineKey = (l: { item: GroceryItem; packing?: PackingOption; variant?: string }) => `${l.item.id}::${l.variant ?? ""}::${l.packing?.label ?? ""}`;
const lineDisplayName = (l: CartLine) =>
  l.variant && l.packing ? `${l.item.name} (${l.variant} · ${l.packing.label})`
  : l.variant ? `${l.item.name} (${l.variant})`
  : l.packing ? `${l.item.name} (${l.packing.label})`
  : l.item.name;
// Flavours/types under the master (the implicit "Standard" is not a choice).
const namedVariants = (item: GroceryItem): GroceryVariant[] =>
  (item.variants ?? []).filter((v) => v.name !== "Standard");

const PAYMENTS: { name: PaymentMethod; emoji: string; color: string }[] = [
  { name: "Cash", emoji: "💵", color: "#16A34A" },
  { name: "JazzCash", emoji: "📱", color: "#ED1C24" },
  { name: "Easypaisa", emoji: "📲", color: "#4CB050" },
  { name: "Udhaar", emoji: "📒", color: "#F59E0B" },
];

const fmtQty = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(1));
const money = (n: number) => `Rs ${Math.round(n).toLocaleString()}`;

function GroceryScreen() {
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [heads, setHeads] = useState<GroceryHead[]>([]);
  const [subs, setSubs] = useState<GrocerySubHead[]>([]);
  const [head, setHead] = useState<string>("all");
  const [sub, setSub] = useState<string>("all");
  const [chooserItem, setChooserItem] = useState<GroceryItem | null>(null);
  const [chooserVariant, setChooserVariant] = useState<string | null>(null); // variant step of the chooser (Phase 2)
  const shop = useShop();
  const [search, setSearch] = useState("");
  const [barcode, setBarcode] = useState("");
  // ── Barcode scanner (hardware HID + camera) ──
  const scanRef = useRef<HTMLInputElement>(null);
  // Stepper guard: the tile's press animation shifts the tile mid-press, so a
  // real press on a tile's −/+ can land its click on the TILE (which adds).
  // Steppers therefore act on pointerdown (hit-tested correctly) and stamp
  // this guard; tileTap ignores any tap right after a stepper press.
  const stepperGuard = useRef<{ id: string; at: number }>({ id: "", at: 0 });
  const stepperPressed = (id: string) => { stepperGuard.current = { id, at: Date.now() }; };
  const stepperJustPressed = (id: string) => stepperGuard.current.id === id && Date.now() - stepperGuard.current.at < 700;
  const [scanToast, setScanToast] = useState<{ ok: boolean; text: string; key: number } | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [camOpen, setCamOpen] = useState(false);
  const [scannerTestOpen, setScannerTestOpen] = useState(false);
  const [camMsg, setCamMsg] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const camTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastCamCodeRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const [priceType, setPriceType] = useState<"retail" | "wholesale">("retail");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("Cash");
  const [discountType, setDiscountType] = useState<"Rs" | "%">("Rs");
  const [discountInput, setDiscountInput] = useState("");
  const [pendingBillNo, setPendingBillNo] = useState("");
  const [tendered, setTendered] = useState(0);
  // Manual cash entry (Talha, 14 Nov): the cashier can also TYPE the amount.
  // tenderedText mirrors `tendered` — typing sets Received directly, the
  // quick-add / Exact / Clear buttons write through applyTendered so both
  // stay in sync. Plain controlled input, same pattern as Discount above;
  // the page-level scanner-burst listener ignores keystrokes while any
  // input (like this one) has focus, so normal typing is never misread.
  const [tenderedText, setTenderedText] = useState("");
  const applyTendered = (n: number) => { setTendered(n); setTenderedText(n > 0 ? String(Math.round(n)) : ""); };
  const typeTendered = (v: string) => { const d = v.replace(/\D/g, ""); setTenderedText(d); setTendered(d === "" ? 0 : parseInt(d, 10)); };
  const [udhaarName, setUdhaarName] = useState("");
  const [done, setDone] = useState<Order | null>(null);
  // Online grocery orders (remote accounts) — packing queue, NOT the kitchen.
  // Payment-proof gate: the packing queue holds only payment-CLEARED orders;
  // proof_pending ones are listed separately (awareness strip) and enter the
  // queue only when the owner confirms their payment.
  const [onlineOrders, setOnlineOrders] = useState<Order[]>([]);
  const [proofOrders, setProofOrders] = useState<Order[]>([]);

  function splitOnline(all: Order[]) {
    const todaysOnline = all.filter((o) => o.source === "online" && o.mode === "grocery" && isToday(o));
    setOnlineOrders(todaysOnline.filter(isPaymentCleared));
    setProofOrders(todaysOnline.filter((o) => o.paymentStatus === "proof_pending"));
  }

  useEffect(() => {
    setItems(loadGrocery());
    setHeads(loadGroceryHeads());
    setSubs(loadGrocerySubHeads());
    const refreshOnline = () => splitOnline(loadOrders());
    refreshOnline();
    const t = setInterval(refreshOnline, 2000);
    window.addEventListener("storage", refreshOnline);
    return () => { clearInterval(t); window.removeEventListener("storage", refreshOnline); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Scanner plumbing ──────────────────────────────────────────────────────
  // Refs always point at the latest render's functions/state, so the global
  // keydown listener and the camera loop (bound once) never go stale.
  const scanAddRef = useRef<(code: string) => boolean>(() => false);
  scanAddRef.current = (code: string) => scanAdd(code);
  const modalOpenRef = useRef(false);
  // Scanner Test khula ho to bursts sirf test panel ko jayein — bill mein
  // item add na ho (warna ek scan do jagah asar karega).
  modalOpenRef.current = payOpen || !!done || !!chooserItem || scannerTestOpen;

  // The scan field is ALWAYS ready: focus it on open, after every scan the
  // form keeps focus, and "New Sale" refocuses it (see success screen).
  useEffect(() => { scanRef.current?.focus(); }, []);

  useEffect(() => {
    if (!scanToast) return;
    const id = setTimeout(() => setScanToast(null), 1700);
    return () => clearTimeout(id);
  }, [scanToast]);
  useEffect(() => {
    if (!flashId) return;
    const id = setTimeout(() => setFlashId(null), 900);
    return () => clearTimeout(id);
  }, [flashId]);

  // Page-level scanner-burst listener: USB/Bluetooth scanners "type" the
  // code very fast and finish with Enter. If focus is inside ANY field
  // (search box, the scan field itself, udhaar name…) typing is left
  // completely alone — the scan field's own form submit handles its scans.
  // Bursts are only captured when NO field has focus (focus got lost).
  useEffect(() => {
    let buf = "";
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      if (modalOpenRef.current) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const now = performance.now();
      if (now - last > 60) buf = "";
      last = now;
      if (e.key === "Enter") {
        if (buf.length >= 3) scanAddRef.current(buf);
        buf = "";
      } else if (e.key.length === 1) {
        buf += e.key;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Camera scanning (getUserMedia + built-in BarcodeDetector, Chrome/Android).
  useEffect(() => {
    if (!camOpen) return;
    let cancelled = false;
    (async () => {
      type Detector = new (opts: object) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
      const BD = (window as unknown as { BarcodeDetector?: Detector }).BarcodeDetector;
      if (!BD) {
        setCamMsg("⚠️ Is browser mein camera scan nahi hai — barcode / SKU type karke Enter dabayein. (Camera scan Chrome / Android par chalta hai)");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        camStreamRef.current = stream;
        const video = videoRef.current;
        if (video) { video.srcObject = stream; await video.play().catch(() => {}); }
        const detector = new BD({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code"] });
        camTimerRef.current = setInterval(async () => {
          const v = videoRef.current;
          if (!v || v.readyState < 2) return;
          try {
            const codes = await detector.detect(v);
            const raw = codes?.[0]?.rawValue?.trim();
            if (raw) {
              const now = Date.now();
              // 1.5s cooldown per code so holding one product doesn't add 20×
              if (!(lastCamCodeRef.current.code === raw && now - lastCamCodeRef.current.at < 1500)) {
                lastCamCodeRef.current = { code: raw, at: now };
                scanAddRef.current(raw);
              }
            }
          } catch { /* frame not ready yet */ }
        }, 250);
      } catch {
        if (!cancelled) setCamMsg("⚠️ Camera ki ijazat nahi mili — barcode / SKU type karke Enter dabayein.");
      }
    })();
    return () => { cancelled = true; stopCameraTracks(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camOpen]);

  function stopCameraTracks() {
    if (camTimerRef.current) { clearInterval(camTimerRef.current); camTimerRef.current = null; }
    if (camStreamRef.current) { camStreamRef.current.getTracks().forEach((t) => t.stop()); camStreamRef.current = null; }
  }
  function openCamera() { setCamMsg(""); setCamOpen(true); }
  function closeCamera() { stopCameraTracks(); setCamOpen(false); setCamMsg(""); scanRef.current?.focus(); }

  function setOnlineStatus(id: string, status: Order["status"]) {
    const next = loadOrders().map((o) => (o.id === id ? { ...o, status } : o));
    saveOrders(next);
    splitOnline(next);
  }

  // Retail respects an ACTIVE offer price (boardOffer + offerPrice <
  // retail): the base price follows effectiveRetail; wholesale never does.
  const priceOf = (it: GroceryItem) => (priceType === "retail" ? effectiveRetail(it) : it.wholesalePrice);
  const total = useMemo(() => cart.reduce((s, l) => s + l.price * l.qty, 0), [cart]);
  const discountVal = parseFloat(discountInput) || 0;
  const discountAmt = Math.min(total, discountType === "Rs" ? discountVal : Math.round((total * discountVal) / 100));
  const grand = total - discountAmt;

  // Head → Sub-Head filter (3-level structure): tiles show only the
  // selected head, then sub-head — EXCEPT while searching, when results
  // come from ALL heads (390 products: the cashier must never miss an item
  // by being in the wrong head). Barcode scans ignore filters entirely.
  const searching = search.trim().length > 0;
  const headCount = (id: string) => items.filter((it) => it.headId === id).length;
  const subCount = (id: string) => items.filter((it) => it.subId === id).length;
  const subsOfHead = subs.filter((s) => s.headId === head);
  const visible = items.filter((it) => {
    const q = search.trim().toLowerCase();
    // Search finds masters by item name, BRAND and VARIANT names too
    // ("shampoo" → every company's shampoo; "Sunsilk" → only Sunsilk).
    if (q) return it.name.toLowerCase().includes(q) || it.sku.includes(q)
      || (it.brand ?? "").toLowerCase().includes(q)
      || (it.variants ?? []).some((v) => v.name.toLowerCase().includes(q));
    if (head !== "all" && it.headId !== head) return false;
    if (head !== "all" && sub !== "all" && it.subId !== sub) return false;
    return true;
  });

  const priceOfPacking = (it: GroceryItem, p: PackingOption) => (priceType === "retail" ? effectivePackingRetail(it, p) : p.wholesalePrice);
  // Total qty of a product across ALL its bill lines (used by packing tiles,
  // whose lines are per-packing).
  const cartQtyOf = (item: GroceryItem) => cart.filter((l) => l.item.id === item.id).reduce((s, l) => s + l.qty, 0);

  function add(item: GroceryItem, packing?: PackingOption, variantName?: string) {
    const step = packing ? 1 : item.unit === "kg" ? 0.5 : 1;
    const price = packing ? priceOfPacking(item, packing) : priceOf(item);
    const key = lineKey({ item, packing, variant: variantName });
    setCart((c) => {
      const f = c.find((l) => lineKey(l) === key);
      if (f) return c.map((l) => (lineKey(l) === key ? { ...l, qty: Math.round((l.qty + step) * 10) / 10, price } : l));
      return [...c, { item, qty: step, price, packing, variant: variantName }];
    });
  }
  // Tile tap (Phase 2 flow): a master WITH flavours opens VARIANT selection
  // first, then the variant's packings; steps that don't exist are skipped.
  function tileTap(item: GroceryItem) {
    if (stepperJustPressed(item.id)) return; // the tap was a stepper press, not a tile tap
    if (namedVariants(item).length) { setChooserItem(item); setChooserVariant(null); return; }
    if (item.packings && item.packings.length) { setChooserItem(item); setChooserVariant("Standard"); return; }
    add(item);
  }
  // Wholesale minimum (Phase 2): effective min = packing's own → product's
  // own → shop default (pieces / kg). A line's CONTRIBUTION counts in base
  // units — a Full Dabba counts its containsQty packs. Retail is unaffected.
  function wholesaleMinOf(l: CartLine): number {
    return l.packing?.wholesaleMinQty ?? l.item.wholesaleMinQty ?? (l.item.unit === "kg" ? shop.wholesaleMinKg : shop.wholesaleMinPieces);
  }
  function lineBelowWholesaleMin(l: CartLine): boolean {
    if (priceType !== "wholesale") return false;
    const contribution = l.qty * (l.packing?.containsQty ?? 1);
    return contribution < wholesaleMinOf(l);
  }
  const anyBelowWholesaleMin = priceType === "wholesale" && cart.some(lineBelowWholesaleMin);
  function changeQty(key: string, dir: 1 | -1) {
    setCart((c) => c.map((l) => {
      if (lineKey(l) !== key) return l;
      const step = l.packing ? 1 : l.item.unit === "kg" ? 0.5 : 1;
      return { ...l, qty: Math.round((l.qty + dir * step) * 10) / 10 };
    }).filter((l) => l.qty > 0));
  }
  function removeLine(key: string) { setCart((c) => c.filter((l) => lineKey(l) !== key)); }

  function switchPriceType(t: "retail" | "wholesale") {
    setPriceType(t);
    setCart((c) => c.map((l) => ({
      ...l,
      price: l.packing
        ? (t === "retail" ? effectivePackingRetail(l.item, l.packing) : l.packing.wholesalePrice)
        : (t === "retail" ? effectiveRetail(l.item) : l.item.wholesalePrice),
    })));
  }

  // Tiny WebAudio beep — no audio asset, no network. Success = short high
  // blip, not-found = low buzz. Pure nicety: wrapped so it can never break a sale.
  function beep(ok: boolean) {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = ok ? 880 : 180;
      gain.gain.value = 0.08;
      osc.start();
      osc.stop(ctx.currentTime + (ok ? 0.07 : 0.15));
      osc.onended = () => { ctx.close().catch(() => {}); };
    } catch { /* ignore */ }
  }
  function showScanToast(ok: boolean, text: string) { setScanToast({ ok, text, key: Date.now() }); }

  // ONE scan path for hardware scanner, burst listener, camera and typed
  // codes: match BARCODE first, then SKU/PLU → add via the same add() the
  // tiles use (pieces +1; per-kg items +0.5 kg step, same as a tile tap).
  // A product WITH packings adds its FIRST packing (the cashier can fix it
  // in the bill) — the toast names the packing so nothing is silent.
  function scanAdd(raw: string): boolean {
    const code = raw.trim();
    if (!code) return false;
    // Phase 2: a PACKING's own EAN resolves first (each brand packing
    // carries its own barcode), then the product barcode, then SKU/PLU.
    for (const it of items) {
      for (const v of it.variants ?? []) {
        const pk = v.packings.find((k) => k.barcode && k.barcode === code);
        if (pk) {
          add(it, pk, v.name === "Standard" ? undefined : v.name);
          beep(true);
          setFlashId(it.id);
          showScanToast(true, `✓ Added: ${it.name} (${pk.label})`);
          return true;
        }
      }
    }
    const found = items.find((it) => it.barcode && it.barcode === code) || items.find((it) => it.sku === code);
    if (found) {
      const pk = found.packings && found.packings.length ? found.packings[0] : undefined;
      add(found, pk);
      beep(true);
      setFlashId(found.id);
      showScanToast(true, pk ? `✓ Added: ${found.name} (${pk.label})` : `✓ Added: ${found.name}`);
      return true;
    }
    beep(false);
    showScanToast(false, `✕ Item not found — code ${code}`);
    return false;
  }

  function submitBarcode(e: React.FormEvent) {
    e.preventDefault();
    scanAdd(barcode);
    setBarcode("");
    scanRef.current?.focus(); // instantly ready for the next scan
  }

  // MOBILE serial/IMEI (Talha, 15 Nov 2026): trackSerial wale product ki
  // line par har unit ka IMEI lazmi hai — pay modal mein inputs ate hain,
  // serials order line par save hote hain aur receipt par print hote hain.
  const [serials, setSerials] = useState<Record<string, string[]>>({});
  const serialLines = cart.filter((l) => l.item.trackSerial);
  const serialsMissing = serialLines.some((l) => {
    const arr = serials[lineKey(l)] ?? [];
    return Array.from({ length: Math.max(1, Math.floor(l.qty)) }, (_, i) => (arr[i] ?? "").trim()).some((s) => !s);
  });

  const change = tendered - grand;
  // Wholesale bills with a below-minimum line can NOT complete (the server
  // refuses them too — WHOLESALE_MIN_QTY).
  const canComplete = cart.length > 0 && !anyBelowWholesaleMin && !serialsMissing && (method !== "Cash" || tendered >= grand);

  function complete() {
    if (!canComplete) return;
    const orders = loadOrders();
    const order: Order = {
      id: `ord-${Date.now()}`,
      billNo: pendingBillNo || nextBillNo(orders),
      cashier: getStaffSessionMember()?.name ?? "Counter 1",
      mode: "grocery",
      priceType,
      token: nextToken(orders, "grocery"),
      // Offer-priced lines carry a tiny "(Offer)" tag in the receipt name —
      // the server stamps the same tag from its is_offer snapshot.
      lines: cart.map((l) => ({
        itemId: l.item.id,
        name: `${l.variant || l.packing ? lineDisplayName(l) : `${l.item.name}${l.item.unit === "kg" ? " (kg)" : ""}`}${priceType === "retail" && lineIsOffer(l.item, l.packing) ? " (Offer)" : ""}`,
        price: l.price, qty: l.qty,
        // Serial-tracked (mobile) lines carry one IMEI per unit
        ...(l.item.trackSerial ? { serials: (serials[lineKey(l)] ?? []).map((s) => s.trim()).filter(Boolean) } : {}),
      })),
      subtotal: Math.round(total),
      discount: Math.round(discountAmt),
      total: Math.round(grand),
      payment: method,
      tendered: method === "Cash" ? tendered : undefined,
      change: method === "Cash" ? Math.round(change) : undefined,
      udhaarName: method === "Udhaar" ? (udhaarName.trim() || "—") : undefined,
      status: "ready", // grocery = handed over at counter, never sent to kitchen
      createdAt: new Date().toISOString(),
    };
    saveOrders([order, ...orders]);
    // deduct stock (same stock engine as the rest of the system) — per
    // PRODUCT, in BASE units: a Full Dabba line removes containsQty packs
    // from the one pool (the server does the same inside the order tx).
    const next = items.map((it) => {
      const used = cart.filter((l) => l.item.id === it.id).reduce((s, l) => s + l.qty * (l.packing?.containsQty ?? 1), 0);
      return used ? { ...it, stock: Math.max(0, Math.round((it.stock - used) * 10) / 10) } : it;
    });
    setItems(next); saveGrocery(next);
    setDone(order);
    setCart([]);
    setSerials({});
    setPayOpen(false);
    applyTendered(0);
    setUdhaarName("");
    setDiscountInput("");
  }

  return (
    <div className="min-h-screen lg:h-screen flex flex-col lg:overflow-hidden">
      <TopBar />
      <OrderAlerts role="grocery" />
      <div className="px-4 py-1.5 text-xs font-bold text-stone-500 bg-orange-100/60 flex justify-between">
        <span>🛒 {shop.retailType === "grocery" || shop.retailType === "supermarket" ? "GROCERY MODE" : "SELL MODE"}</span><span className="font-bold" style={{ color: "#F59E0B" }}>SAMPLE products — real list pending</span>
      </div>

      <div className="flex flex-1 min-h-0 flex-col lg:flex-row overflow-hidden">
        <main className="flex-1 p-3 lg:p-4 overflow-y-auto">
          {/* Search + barcode ONLY (Phase 2 layout rule: the Retail /
              Wholesale toggle is the BILL's price type — it lives in the
              Bill panel header, not this toolbar). */}
          <div className="flex flex-wrap gap-2 mb-3">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 Search product, brand ya flavour…"
              className="rounded-xl border-2 border-stone-200 bg-white px-4 py-3 flex-1 min-w-[150px] sm:min-w-[180px] text-base outline-none focus:border-orange-500" />
            <form onSubmit={submitBarcode} className="flex flex-wrap gap-2 flex-1 min-w-0 sm:min-w-[240px]">
              <input ref={scanRef} value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="🔫 Scan barcode ya SKU/PLU + Enter (try 8961000003001 ya 1001)"
                className="rounded-xl border-2 border-dashed border-stone-300 bg-white px-4 py-3 flex-1 min-w-0 text-base outline-none focus:border-orange-500" />
              <button type="submit" className="rounded-xl px-4 font-extrabold text-white" style={{ background: "#0F172A" }}>Add</button>
              <button type="button" onClick={openCamera} className="rounded-xl px-4 font-extrabold text-white whitespace-nowrap" style={{ background: "#1976D2" }}>📷 Camera Scan</button>
              <button type="button" onClick={() => setScannerTestOpen((v) => !v)} data-testid="scanner-test-toggle" className="rounded-xl px-4 font-extrabold text-white whitespace-nowrap" style={{ background: "#78716C" }}>🔫 Scanner Test</button>
            </form>
            {scannerTestOpen && (
              <div className="mt-3 rounded-2xl bg-white p-1">
                <ScannerTest />
              </div>
            )}
          </div>
          {/* Head chips (row 1) — Main Head → Sub Head → Product. Only heads
              that HAVE products get a chip (empty heads stay owner-side
              only); search overrides both filter rows */}
          <div className="flex gap-2 mb-2 overflow-x-auto pb-1" data-testid="head-chips">
            <button onClick={() => { setHead("all"); setSub("all"); }}
              className="rounded-full px-4 py-2.5 font-extrabold border-2 whitespace-nowrap transition"
              style={head === "all" ? { background: "#F97316", borderColor: "#F97316", color: "#fff" } : { background: "#fff", borderColor: "#E7E5E4", color: "#44403C" }}>
              🛒 Sab (All) <span className="opacity-80">({items.length})</span>
            </button>
            {heads.filter((h) => headCount(h.id) > 0).map((h) => {
              const active = head === h.id;
              return (
                <button key={h.id} onClick={() => { setHead(h.id); setSub("all"); }}
                  className="rounded-full px-4 py-2.5 font-extrabold border-2 whitespace-nowrap transition"
                  style={active ? { background: "#F97316", borderColor: "#F97316", color: "#fff" } : { background: h.tint, borderColor: "#E7E5E4", color: "#44403C" }}>
                  {h.emoji} {h.name} <span className="opacity-80">({headCount(h.id)})</span>
                </button>
              );
            })}
          </div>
          {/* Sub-head chips (row 2) — only when a main head is selected */}
          {head !== "all" && (
            <div className="flex gap-2 mb-2 overflow-x-auto pb-1" data-testid="sub-chips">
              <button onClick={() => setSub("all")}
                className="rounded-full px-3.5 py-2 font-bold border-2 whitespace-nowrap transition text-sm"
                style={sub === "all" ? { background: "#0F172A", borderColor: "#0F172A", color: "#fff" } : { background: "#fff", borderColor: "#E7E5E4", color: "#44403C" }}>
                All <span className="opacity-80">({headCount(head)})</span>
              </button>
              {subsOfHead.filter((s) => subCount(s.id) > 0).map((s) => {
                const active = sub === s.id;
                return (
                  <button key={s.id} onClick={() => setSub(s.id)}
                    className="rounded-full px-3.5 py-2 font-bold border-2 whitespace-nowrap transition text-sm"
                    style={active ? { background: "#0F172A", borderColor: "#0F172A", color: "#fff" } : { background: "#fff", borderColor: "#E7E5E4", color: "#44403C" }}>
                    {s.name} <span className="opacity-80">({subCount(s.id)})</span>
                  </button>
                );
              })}
            </div>
          )}
          {searching && (
            <p className="text-sm font-bold mb-3 rounded-xl bg-blue-50 border border-blue-100 px-3 py-2" style={{ color: "#1976D2" }}>
              🔍 Search results — saare heads se ({visible.length} item{visible.length === 1 ? "" : "s"} mile)
            </p>
          )}
          {/* Camera scan panel — getUserMedia + BarcodeDetector (Chrome/Android) */}
          {camOpen && (
            <div className="mb-3 rounded-2xl p-3 text-white pop-in" style={{ background: "#0F172A" }}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="font-extrabold">📷 Camera Scan — product ka barcode camera ke samne rakhein</span>
                <button onClick={closeCamera} className="rounded-lg px-3 py-1.5 font-extrabold text-white whitespace-nowrap" style={{ background: "#DC2626" }}>✕ Band karein</button>
              </div>
              {camMsg ? (
                <p className="font-bold rounded-xl bg-white/10 p-3">{camMsg}</p>
              ) : (
                <video ref={videoRef} className="w-full max-h-64 rounded-xl bg-black object-cover" muted playsInline />
              )}
              <p className="text-xs opacity-70 mt-2">Scan hote hi item bill mein add ho jayega — camera khula rahega, agla item scan karein.</p>
            </div>
          )}
          {/* Scan feedback toast (also used by the hardware scanner + burst listener) */}
          {scanToast && (
            <div key={scanToast.key} className={`fixed left-1/2 bottom-6 z-[70] -translate-x-1/2 rounded-full px-6 py-3 text-lg font-black text-white shadow-2xl pop-in ${scanToast.ok ? "" : "shake"}`}
              style={{ background: scanToast.ok ? "#16A34A" : "#DC2626" }}>
              {scanToast.text}
            </div>
          )}

          {/* ── Payment tasdeeq baqi — awareness only (read-only): these
              online orders are NOT in the packing queue yet; the owner
              confirms their payment proof in the Dashboard, then
              they enter the queue below with a token. ── */}
          {proofOrders.length > 0 && (
            <section className="mb-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-3" data-testid="pending-proof-strip">
              <h2 className="font-extrabold mb-1" style={{ color: "#92400E" }}>⏳ Payment tasdeeq baqi ({proofOrders.length})</h2>
              <p className="text-xs font-bold text-stone-500 mb-2">Yeh online orders abhi packing queue mein NAHI aayenge — pehle Dashboard se in ki payment confirm hogi, phir token ke sath queue mein aayenge.</p>
              <div className="space-y-1">
                {proofOrders.map((o) => (
                  <div key={o.id} className="flex flex-wrap gap-x-3 items-center rounded-xl bg-white border border-amber-100 px-3 py-1.5 text-sm">
                    <b>{o.customerName}</b>
                    <span className="text-stone-500 font-bold">{o.placeLabel}</span>
                    <span className="font-bold">{o.lines.length} items</span>
                    <span className="ml-auto font-black">Rs {o.total.toLocaleString()} · {o.paymentProof?.method ?? "Online"}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Online Orders — packing queue for remote grocery orders ── */}
          {onlineOrders.length > 0 && (
            <section className="mb-4 rounded-2xl border-2 border-green-200 bg-green-50/70 p-3" data-testid="packing-queue">
              <h2 className="font-extrabold mb-2">🌐 Online Orders — Packing Queue <span className="text-sm text-stone-500 font-bold">(yeh orders Kitchen mein NAHI jaate — yahin pack hote hain)</span></h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {onlineOrders.map((o) => (
                  <div key={o.id} className="rounded-2xl bg-white border border-green-100 shadow-sm p-3" style={o.status === "ready" ? { opacity: 0.65 } : undefined}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[11px] font-black rounded-full px-2.5 py-1 text-white" style={{ background: "#388E3C" }}>🌐 ONLINE — {o.customerName?.toUpperCase()}</span>
                        <div className="text-xs font-bold text-stone-500 mt-1">{o.placeLabel} · {o.customerMobile}{o.customerId ? ` · ID: ${o.customerId}` : ""}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-black leading-none" style={{ color: "#F97316" }}>{o.token}</div>
                        <div className="text-[10px] font-bold text-stone-400">TOKEN · {o.billNo}</div>
                      </div>
                    </div>
                    <ul className="mt-2 space-y-0.5 text-sm">
                      {o.lines.map((l, i) => (
                        <li key={`${l.itemId}-${i}`} className="flex justify-between gap-2 border-b border-dashed border-stone-200 pb-0.5"><span className="flex-1 min-w-0 leading-snug">{l.name}</span><b className="shrink-0">× {fmtQty(l.qty)}</b></li>
                      ))}
                    </ul>
                    <div className="flex justify-between font-black mt-2"><span>Total · {o.payment}</span><span>Rs {o.total.toLocaleString()}</span></div>
                    {o.status === "pending" && (
                      <button onClick={() => setOnlineStatus(o.id, "preparing")} className="mt-2 w-full rounded-xl py-2.5 font-black text-white" style={{ background: "#F59E0B" }}>📦 Start Packing</button>
                    )}
                    {o.status === "preparing" && (
                      <button onClick={() => setOnlineStatus(o.id, "ready")} className="mt-2 w-full rounded-xl py-2.5 font-black text-white" style={{ background: "#16A34A" }}>✓ Ready for Pickup</button>
                    )}
                    {o.status === "ready" && <div className="mt-2 text-center font-black rounded-xl py-2 bg-green-100" style={{ color: "#16A34A" }}>✅ READY — customer pickup karega</div>}
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
            {visible.map((item, idx) => {
              const hasPackings = !!(item.packings && item.packings.length);
              const totalQty = cartQtyOf(item);
              const lineQty = hasPackings ? undefined : cart.find((l) => l.item.id === item.id && !l.packing)?.qty;
              const low = item.stock <= (item.unit === "kg" ? 10 : 15);
              const TINTS = ["#FFFBEB", "#EFF6FF", "#F0FDF4", "#FDF2F8", "#F5F3FF", "#FFF7ED"];
              const minPacking = hasPackings ? Math.min(...item.packings!.map((p) => priceOfPacking(item, p))) : 0;
              const img = groceryImage(item, heads, subs); // product → sub-head → head → emoji
              return (
                <div key={item.id} onClick={() => tileTap(item)} data-testid="grocery-tile" data-name={item.name} role="button" aria-label={`Add ${item.name}`}
                  className="tile-3d relative rounded-2xl p-4 text-left shadow-sm border-2 min-h-[128px] cursor-pointer select-none"
                  style={{ background: TINTS[idx % TINTS.length], borderColor: totalQty ? "#F97316" : "transparent" }}>
                  <div className="mb-1">{img
                    ? <img src={img} alt={item.name} loading="lazy" className="w-12 h-12 rounded-2xl object-cover shadow-sm" />
                    : <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-white/70 shadow-sm text-3xl">{item.emoji}</span>}</div>
                  <div className="font-bold leading-tight text-[15px]">{item.name}</div>
                  <div className="mt-1 font-extrabold" style={{ color: "#F97316" }}>
                    {hasPackings ? <>{money(minPacking)}<span className="text-xs text-stone-500"> se start</span></> : <>{money(priceOf(item))}{item.unit === "kg" ? <span className="text-xs text-stone-500"> / kg</span> : null}</>}
                  </div>
                  {priceType === "retail" && offerActive(item) && (
                    <span className="inline-block mt-0.5 text-[10px] font-black px-1.5 py-0.5 rounded-full text-white" style={{ background: "#DC2626" }}>🎉 OFFER {money(item.offerPrice as number)}</span>
                  )}
                  <div className="text-xs text-stone-500 mt-0.5">
                    SKU {item.sku}{item.barcode ? <> · 🏷️ {item.barcode}</> : ""} · Stock: <b style={{ color: low ? "#DC2626" : "#16A34A" }}>{fmtQty(item.stock)} {item.unit === "kg" ? "kg" : "pcs"}</b>
                    {!hasPackings && priceType === "retail" && <span> · WS {money(item.wholesalePrice)}</span>}
                  </div>
                  {hasPackings && (
                    <div className="text-xs font-bold mt-0.5" style={{ color: "#0F172A" }}>📦 {item.packings!.map((p) => p.label).join(" · ")}</div>
                  )}
                  {/* Packing products: badge = TOTAL qty across packing lines,
                      no on-tile stepper (qty is managed in chooser / bill).
                      Plain products: on-tile − qty + stepper like the canteen. */}
                  {hasPackings ? (
                    totalQty > 0 ? (
                      <span className="absolute bottom-2 right-2 text-white text-sm font-extrabold rounded-full min-w-7 h-7 px-1 flex items-center justify-center" style={{ background: "#F97316" }}>{fmtQty(totalQty)}</span>
                    ) : (
                      <span className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-white/80 border-2 border-stone-200 shadow-sm flex items-center justify-center text-lg font-black text-stone-500">+</span>
                    )
                  ) : lineQty ? (
                    <>
                      <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-white/90 shadow px-1 py-1" data-testid="tile-stepper" onClick={(e) => e.stopPropagation()}>
                        <button type="button" aria-label={`Remove one ${item.name}`}
                          onPointerDown={(e) => { e.stopPropagation(); stepperPressed(item.id); changeQty(lineKey({ item }), -1); }}
                          onClick={(e) => { e.stopPropagation(); if (e.detail === 0) changeQty(lineKey({ item }), -1); }}
                          className="w-8 h-8 rounded-full bg-white border-2 border-stone-300 text-base font-black leading-none active:scale-95">−</button>
                        <span className="min-w-6 text-center font-black text-[15px]" data-testid="tile-qty">{fmtQty(lineQty)}</span>
                        <button type="button" aria-label={`Add one ${item.name}`}
                          onPointerDown={(e) => { e.stopPropagation(); stepperPressed(item.id); changeQty(lineKey({ item }), 1); }}
                          onClick={(e) => { e.stopPropagation(); if (e.detail === 0) changeQty(lineKey({ item }), 1); }}
                          className="w-8 h-8 rounded-full text-white text-base font-black leading-none active:scale-95" style={{ background: "#F97316" }}>+</button>
                      </span>
                      <span className="absolute bottom-2 right-2 text-white text-sm font-extrabold rounded-full min-w-7 h-7 px-1 flex items-center justify-center" style={{ background: "#F97316" }}>{fmtQty(lineQty)}</span>
                    </>
                  ) : (
                    <span className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-white/80 border-2 border-stone-200 shadow-sm flex items-center justify-center text-lg font-black text-stone-500">+</span>
                  )}
                </div>
              );
            })}
          </div>
          {visible.length === 0 && <p className="text-stone-500 p-4">No product matches. Try another search or a SKU code.</p>}
          <p className="text-xs text-stone-400 mt-4">Weight items (atta, cheeni, chawal, daal) add in 0.5 kg steps — use +/− in the bill for 0.5 / 1.5 kg etc. Prices change with the Retail / Wholesale toggle.</p>
        </main>

        {/* RIGHT — bill panel, same pattern as canteen */}
        <aside className="lg:w-[340px] xl:w-[380px] shrink-0 bg-white border-t lg:border-t-0 lg:border-l border-orange-100 flex flex-col max-h-[52vh] lg:max-h-none">
          <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-2">
            <h2 className="font-extrabold text-lg">Current Bill</h2>
            {/* Price type is the BILL's property (Phase 2 layout rule) —
                the toggle lives here in the Bill panel header. */}
            <div className="flex rounded-xl overflow-hidden border-2 border-stone-200" data-testid="bill-price-type">
              {(["retail", "wholesale"] as const).map((t) => (
                <button key={t} onClick={() => switchPriceType(t)} className="px-3 py-1.5 text-sm font-extrabold capitalize"
                  style={priceType === t ? { background: "#F97316", color: "#fff" } : { background: "#fff", color: "#44403C" }}>
                  {t === "retail" ? "🏷️ Retail" : "📦 Wholesale"}
                </button>
              ))}
            </div>
            {cart.length > 0 && <button onClick={() => setCart([])} className="text-sm font-bold" style={{ color: "#DC2626" }}>Clear ✕</button>}
          </div>
          <div className="flex-1 overflow-y-auto px-4 space-y-2 pb-2">
            {cart.length === 0 && <p className="text-stone-400 text-center py-8">Tap a product, search, or type a barcode 👈</p>}
            {cart.map((l) => {
              const key = lineKey(l);
              return (
              <div key={key} className={`flex items-center gap-2 rounded-xl bg-orange-50/60 border border-orange-100 px-3 py-2 ${flashId === l.item.id ? "scan-flash" : ""}`}>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm leading-tight">{lineDisplayName(l)}</div>
                  <div className="text-xs text-stone-500">{money(l.price)}{l.item.unit === "kg" ? "/kg" : ""} × {fmtQty(l.qty)}{l.item.unit === "kg" ? " kg" : ""} = <b>{money(l.price * l.qty)}</b></div>
                  {lineBelowWholesaleMin(l) && (
                    <div className="text-xs font-bold" style={{ color: "#DC2626" }}>⚠️ Wholesale ke liye kam az kam {wholesaleMinOf(l)} lazmi hai</div>
                  )}
                </div>
                <button onClick={() => changeQty(key, -1)} className="w-9 h-9 rounded-full bg-white border-2 border-stone-200 text-lg font-extrabold">−</button>
                <span className="w-8 text-center font-extrabold">{fmtQty(l.qty)}</span>
                <button onClick={() => changeQty(key, 1)} className="w-9 h-9 rounded-full bg-white border-2 border-stone-200 text-lg font-extrabold">+</button>
                <button onClick={() => removeLine(key)} className="w-8 h-8 rounded-full text-white font-bold" style={{ background: "#DC2626" }}>✕</button>
              </div>
              );
            })}
          </div>
          <div className="p-4 border-t-2 border-stone-800/70 bg-[#FFFBF5]">
            <div className="flex justify-between text-sm py-0.5 border-b border-dashed border-stone-300">
              <span className="font-bold text-stone-500">Subtotal</span><span className="font-bold">{money(total)}</span>
            </div>
            {discountAmt > 0 && (
              <div className="flex justify-between text-sm py-0.5 border-b border-dashed border-stone-300">
                <span className="font-bold" style={{ color: "#16A34A" }}>Discount</span><span className="font-bold" style={{ color: "#16A34A" }}>− {money(discountAmt)}</span>
              </div>
            )}
            <div className="flex items-end justify-between my-2 py-1.5" style={{ borderTop: "4px double #0F172A", borderBottom: "4px double #0F172A" }}>
              <span className="font-black text-stone-600">GRAND TOTAL</span>
              <span className="text-4xl font-black" style={{ color: "#F97316" }}>{money(grand)}</span>
            </div>
            {anyBelowWholesaleMin && (
              <p className="text-xs font-bold mb-2" style={{ color: "#DC2626" }}>⚠️ Wholesale bill: neeche wali line(s) minimum quantity se kam hain — pehle quantity poori karein.</p>
            )}
            <button disabled={cart.length === 0 || anyBelowWholesaleMin} onClick={() => { setMethod("Cash"); applyTendered(0); setPendingBillNo(nextBillNo(loadOrders())); setPayOpen(true); }}
              className="w-full rounded-2xl py-4 text-xl font-black text-white disabled:opacity-40 active:scale-[0.99]" style={{ background: "#F97316" }}>
              PAY / Charge →
            </button>
          </div>
        </aside>
      </div>

      {/* Variant → Packing chooser (Phase 2): a flavour/type is a VARIANT of
          the master; a size is a PACKING of the variant. Choosing bills
          `Name (Variant · Packing)` at that packing's price (per the bill's
          Retail / Wholesale type). Steps that don't exist are skipped. */}
      {chooserItem && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-3" role="dialog" aria-label="Choose variant and packing">
          <div className="bg-white rounded-3xl w-full max-w-md p-5 pop-in">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xl font-extrabold">{chooserItem.emoji} {chooserItem.name}</h3>
              <button onClick={() => { setChooserItem(null); setChooserVariant(null); }} className="text-2xl font-bold text-stone-400">✕</button>
            </div>
            {chooserVariant === null ? (
              <>
                <p className="text-sm text-stone-500 font-bold mb-3">Flavour / type chunein — ye isi product ka variant hai. ({priceType === "retail" ? "🏷️ Retail" : "📦 Wholesale"} prices)</p>
                <div className="space-y-2">
                  {namedVariants(chooserItem).map((v) => {
                    if (v.packings.length) {
                      return (
                        <button key={v.name} onClick={() => setChooserVariant(v.name)}
                          className="w-full flex items-center justify-between rounded-2xl border-[3px] border-stone-200 hover:border-orange-400 px-4 py-3.5 text-left active:scale-[0.99] transition">
                          <span className="font-black text-lg">🎨 {v.name}</span>
                          <span className="text-sm font-bold text-stone-400">{v.packings.length} packings →</span>
                        </button>
                      );
                    }
                    // Variant with NO packings: the row itself is a stepper row.
                    const key = lineKey({ item: chooserItem, variant: v.name });
                    const q = cart.find((l) => lineKey(l) === key)?.qty ?? 0;
                    return (
                      <div key={v.name} className="w-full flex items-center justify-between rounded-2xl border-[3px] px-4 py-3 transition"
                        style={q > 0 ? { borderColor: "#F97316", background: "#FFF7ED" } : { borderColor: "#E7E5E4" }}>
                        <span className="font-black text-lg">🎨 {v.name}</span>
                        {q === 0 ? (
                          <button onClick={() => add(chooserItem, undefined, v.name)} className="w-10 h-10 rounded-full text-white text-2xl font-black leading-none" style={{ background: "#F97316" }} aria-label={`Add ${v.name}`}>+</button>
                        ) : (
                          <span className="flex items-center gap-2">
                            <button onClick={() => changeQty(key, -1)} className="w-9 h-9 rounded-full bg-white border-2 border-stone-200 text-lg font-extrabold" aria-label="Kam karein">−</button>
                            <span className="w-7 text-center font-black text-lg">{fmtQty(q)}</span>
                            <button onClick={() => add(chooserItem, undefined, v.name)} className="w-9 h-9 rounded-full text-white text-lg font-extrabold" style={{ background: "#F97316" }} aria-label="Barhayein">+</button>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-stone-500 font-bold mb-3">
                  {namedVariants(chooserItem).length > 0 && (
                    <button onClick={() => setChooserVariant(null)} className="mr-2 font-black" style={{ color: "#F97316" }}>← Variants</button>
                  )}
                  Packing chunein{chooserVariant !== "Standard" ? ` — ${chooserVariant}` : ""} — har packing ki quantity yahin set karein. ({priceType === "retail" ? "🏷️ Retail" : "📦 Wholesale"} prices)
                </p>
                <div className="space-y-2">
                  {(chooserVariant === "Standard"
                    ? (chooserItem.packings ?? [])
                    : (chooserItem.variants ?? []).find((v) => v.name === chooserVariant)?.packings ?? []
                  ).map((p) => {
                    // Stepper rows (Talha's chooser rule): qty 0 → round
                    // orange "+"; qty > 0 → "− qty +" stepper on the SAME
                    // cart line, row highlighted; minus at 1 removes the
                    // line. The chooser STAYS OPEN for several packings.
                    const vName = chooserVariant === "Standard" ? undefined : chooserVariant;
                    const key = lineKey({ item: chooserItem, packing: p, variant: vName });
                    const q = cart.find((l) => lineKey(l) === key)?.qty ?? 0;
                    return (
                      <div key={p.label} className="w-full flex items-center justify-between rounded-2xl border-[3px] px-4 py-3 transition"
                        style={q > 0 ? { borderColor: "#F97316", background: "#FFF7ED" } : { borderColor: "#E7E5E4" }}>
                        <span className="min-w-0">
                          <span className="font-black text-lg block leading-tight">📦 {p.label}</span>
                          {priceType === "retail" && lineIsOffer(chooserItem, p) ? (
                            <span className="font-black whitespace-nowrap" style={{ color: "#F97316" }}>
                              <s className="text-stone-400 font-bold text-sm">{money(p.retailPrice)}</s> {money(priceOfPacking(chooserItem, p))} <span className="text-[10px] px-1.5 py-0.5 rounded-full text-white align-middle" style={{ background: "#DC2626" }}>🎉 OFFER</span>
                            </span>
                          ) : (
                            <span className="font-black" style={{ color: "#F97316" }}>{money(priceOfPacking(chooserItem, p))}</span>
                          )}
                        </span>
                        {q === 0 ? (
                          <button onClick={() => add(chooserItem, p, vName)} className="w-10 h-10 rounded-full text-white text-2xl font-black leading-none shrink-0" style={{ background: "#F97316" }} aria-label={`Add ${p.label}`}>+</button>
                        ) : (
                          <span className="flex items-center gap-2 shrink-0">
                            <button onClick={() => changeQty(key, -1)} className="w-9 h-9 rounded-full bg-white border-2 border-stone-200 text-lg font-extrabold" aria-label="Kam karein">−</button>
                            <span className="w-7 text-center font-black text-lg">{fmtQty(q)}</span>
                            <button onClick={() => add(chooserItem, p, vName)} className="w-9 h-9 rounded-full text-white text-lg font-extrabold" style={{ background: "#F97316" }} aria-label="Barhayein">+</button>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {/* The chooser no longer closes on add — the cashier sets
                quantities for several packings, then confirms here. */}
            <button onClick={() => { setChooserItem(null); setChooserVariant(null); setTimeout(() => scanRef.current?.focus(), 50); }}
              className="mt-4 w-full rounded-2xl py-3.5 text-lg font-black text-white active:scale-[0.99]" style={{ background: "#16A34A" }}>
              ✓ Ho gaya — Bill dekhein ({cartQtyOf(chooserItem)} add ho gaye)
            </button>
          </div>
        </div>
      )}

      {/* Payment modal — same 4 methods */}
      {payOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-3">
          <div className="bg-white rounded-3xl w-full max-w-lg p-5 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xl font-extrabold">Payment — Sell</h3>
              <button onClick={() => setPayOpen(false)} className="text-2xl font-bold text-stone-400">✕</button>
            </div>
            <div className="text-center text-3xl font-black mb-2" style={{ color: "#F97316" }}>{money(grand)}</div>
            <div className="text-center text-xs text-stone-400 font-bold mb-3">Bill {pendingBillNo} · Subtotal {money(total)}{discountAmt > 0 ? ` · Discount −${money(discountAmt)}` : ""}</div>

            <div className="rounded-2xl border-2 border-dashed border-stone-300 bg-orange-50/50 p-3 mb-4 text-center pop-in">
              <div className="font-black">📱 Scan to Pay — JazzCash / Easypaisa / Raast</div>
              <div className="flex justify-center my-2 bg-white p-2 rounded-xl w-fit mx-auto shadow-sm">
                <QRCode value={paymentPayload(pendingBillNo || "PENDING", grand)} size={132} />
              </div>
              <span className="text-[10px] font-bold rounded-full px-2 py-0.5" style={{ background: "#FEF3C7", color: "#92400E" }}>Demo QR — merchant account pending</span>
            </div>

            <div className="flex items-center gap-2 mb-4">
              <span className="font-bold shrink-0">🏷️ Discount:</span>
              <div className="flex rounded-lg overflow-hidden border-2 border-stone-200">
                {(["Rs", "%"] as const).map((t) => (
                  <button key={t} onClick={() => setDiscountType(t)} className="px-3 py-2 font-extrabold text-sm"
                    style={discountType === t ? { background: "#16A34A", color: "#fff" } : { background: "#fff" }}>{t}</button>
                ))}
              </div>
              <input value={discountInput} onChange={(e) => setDiscountInput(e.target.value)} inputMode="decimal" placeholder="0"
                className="w-24 rounded-lg border-2 border-stone-200 px-3 py-2 outline-none focus:border-green-600" />
              {discountAmt > 0 && <span className="font-bold text-sm" style={{ color: "#16A34A" }}>= −{money(discountAmt)}</span>}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              {PAYMENTS.map((p) => (
                <button key={p.name} onClick={() => setMethod(p.name)}
                  className="rounded-2xl py-4 text-lg font-extrabold border-[3px] transition"
                  style={method === p.name ? { background: p.color, borderColor: p.color, color: "#fff" } : { background: "#fff", borderColor: "#E7E5E4" }}>
                  {p.emoji} {p.name}
                </button>
              ))}
            </div>
            {method === "Cash" && (
              <div className="mb-4">
                <div className="font-bold mb-2">Cash received:</div>
                <label className="block text-sm font-bold text-stone-500 mb-1">✍️ Ya amount khud likhein:</label>
                <input value={tenderedText} onChange={(e) => typeTendered(e.target.value)} inputMode="numeric" placeholder="Amount likhein (Rs)"
                  className="w-full rounded-xl border-2 border-stone-200 px-4 py-3 text-lg font-black outline-none focus:border-green-600 mb-2" />
                <div className="flex gap-2 mb-2">
                  {[100, 500, 1000].map((a) => (
                    <button key={a} onClick={() => applyTendered(tendered + a)} className="flex-1 rounded-xl py-3 font-extrabold text-white" style={{ background: "#16A34A" }}>+ Rs {a}</button>
                  ))}
                  <button onClick={() => applyTendered(Math.round(grand))} className="flex-1 rounded-xl py-3 font-extrabold bg-stone-800 text-white">Exact</button>
                  <button onClick={() => applyTendered(0)} className="rounded-xl px-3 py-3 font-bold bg-stone-100">Clear</button>
                </div>
                <div className="flex justify-between text-lg"><span>Received:</span><b>Rs {tendered.toLocaleString()}</b></div>
                <div className="flex justify-between text-xl mt-1">
                  <span className="font-bold">Change (Baqaya):</span>
                  <b style={{ color: change >= 0 ? "#16A34A" : "#DC2626" }}>{change >= 0 ? money(change) : `${money(Math.abs(change))} short`}</b>
                </div>
              </div>
            )}
            {method === "Udhaar" && (
              <div className="mb-4">
                <label className="font-bold block mb-1">Customer name (khata):</label>
                <input value={udhaarName} onChange={(e) => setUdhaarName(e.target.value)} placeholder="e.g. Haji Sahib — Mohalla customer"
                  className="w-full rounded-xl border-2 border-stone-200 px-4 py-3 text-lg outline-none focus:border-amber-500" />
                <p className="text-xs text-stone-400 mt-1">This sale will be recorded against this customer in the Dashboard.</p>
              </div>
            )}
            {(method === "JazzCash" || method === "Easypaisa") && (
              <p className="mb-4 text-stone-500 text-center">Confirm the {method} payment has been received, then complete.</p>
            )}
            {serialLines.length > 0 && (
              <div className="mb-4 rounded-2xl border-2 border-dashed p-3" style={{ borderColor: "#1976D2", background: "#EFF6FF" }} data-testid="serial-panel">
                <div className="font-black mb-1">📱 IMEI / Serial Number — lazmi</div>
                <p className="text-xs font-bold text-stone-500 mb-2">Har unit ka apna IMEI/serial likhein — ye bill par print hoga (warranty / record ke liye).</p>
                {serialLines.map((l) => (
                  <div key={lineKey(l)} className="mb-2">
                    <div className="font-bold text-sm mb-1">{l.item.emoji} {l.item.name}{l.packing ? ` (${l.packing.label})` : ""} × {Math.floor(l.qty)}</div>
                    {Array.from({ length: Math.max(1, Math.floor(l.qty)) }, (_, i) => (
                      <input key={i} value={serials[lineKey(l)]?.[i] ?? ""}
                        onChange={(e) => setSerials((prev) => { const arr = [...(prev[lineKey(l)] ?? [])]; arr[i] = e.target.value; return { ...prev, [lineKey(l)]: arr }; })}
                        placeholder={`IMEI / Serial #${i + 1}`} data-testid={`serial-input-${l.item.id}-${i}`}
                        className="w-full rounded-xl border-2 border-stone-200 px-4 py-2.5 mb-1.5 font-bold outline-none focus:border-blue-600 bg-white" />
                    ))}
                  </div>
                ))}
                {serialsMissing && <p className="text-xs font-black" style={{ color: "#DC2626" }}>⚠️ Saare IMEI bharein — tab hi sale complete hogi</p>}
              </div>
            )}
            <button disabled={!canComplete} onClick={complete}
              className="w-full rounded-2xl py-4 text-xl font-black text-white disabled:opacity-40" style={{ background: "#16A34A" }}>
              ✓ Complete Sale
            </button>
          </div>
        </div>
      )}

      {/* Success + professional bill */}
      {done && (
        <div className="fixed inset-0 z-50 overflow-y-auto p-4" style={{ background: "#0F172A" }}>
          <div className="max-w-md mx-auto py-4">
            <div className="text-center text-white mb-3">
              <span className="text-xl font-bold" style={{ color: "#16A34A" }}>✅ Sale Done!</span>
              <span className="block text-sm text-stone-400">Stock updated · Sale added to Dashboard 📊</span>
            </div>
            <Receipt order={done} />
            <div className="flex gap-2 mt-4 no-print">
              <button onClick={() => window.print()} className="flex-1 rounded-2xl py-4 text-lg font-black bg-white text-stone-900">🖨️ Print Bill (80mm)</button>
              <button onClick={() => { setDone(null); setTimeout(() => scanRef.current?.focus(), 60); }} className="flex-1 rounded-2xl py-4 text-lg font-black text-white" style={{ background: "#F97316" }}>+ New Sale</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Staff side — role-gated: only staff whose tabs include Grocery see this.
// Business gate: retail setup mein off ho to RetailOnly notice deta hai.
export default function GroceryPage() {
  return (
    <StaffGate tab="grocery">
      <RetailOnly>
        <GroceryScreen />
      </RetailOnly>
    </StaffGate>
  );
}
