"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import TopBar from "@/components/TopBar";
import StaffGate from "@/components/StaffGate";
import ScannerTest from "@/components/ScannerTest";
import { RetailOnly } from "@/components/BusinessGate";
import {
  GroceryItem, MenuItem, StockEntry,
  expiringProducts, expiryLabel,
  loadMenu, saveMenu, loadGrocery, saveGrocery, loadGroceryHeads, loadStockEntries, saveStockEntries, useShop, useStaffSession,
} from "@/lib/store";
import { apiGet } from "@/lib/api";

// ─────────────────────────────────────────────────────────────────────────────
// STOCK screen — the stock keeper's backend screen (Talha, 14 Nov 2026).
// He does NOT sell: he only moves quantities — stock-IN entries (qty +
// purchase rate + supplier) and WASTAGE entries (qty + reason) — for BOTH
// inventories, reading the SAME store state the POS screens sell from, so
// numbers agree everywhere. Selling prices are READ-ONLY here: price
// changes are the owner's job (Owner Dashboard), never the stock keeper's.
// ─────────────────────────────────────────────────────────────────────────────

type Inv = "canteen" | "grocery";

interface StockView {
  id: string;
  name: string;
  emoji: string;
  unitLabel: string; // "pcs" | "kg"
  step: number;
  stock: number;
  price: number; // selling price — display only
  threshold: number;
  low: boolean;
  codeLabel: string; // category (canteen) or SKU/barcode (grocery)
}

interface ScanContext {
  itemId: string;
  code: string;
  variantName?: string;
  packingLabel: string;
  containsQty?: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const fmtQty = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(1));

function StockScreen() {
  const member = useStaffSession();
  const shop = useShop();
  // MEDICAL expiry (Talha, 15 Nov 2026): sirf Medical Store setup mein —
  // stock-IN entry ke sath dawai ki expiry (mahina/saal "YYYY-MM") save
  // hoti hai; qareeb expiry wali cheezein warning list mein ati hain.
  const medical = shop.retailType === "medical";
  const [expiry, setExpiry] = useState("");
  const [menu, setMenuState] = useState<MenuItem[]>(() => loadMenu());
  const [grocery, setGroceryState] = useState<GroceryItem[]>(() => loadGrocery());
  const [entries, setEntries] = useState<StockEntry[]>(() => loadStockEntries());
  const [inv, setInv] = useState<Inv>("canteen");
  const [mode, setMode] = useState<"add" | "wastage">("add");
  const [query, setQuery] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");
  const [supplier, setSupplier] = useState("");
  const [reason, setReason] = useState("Expired");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [scanCode, setScanCode] = useState("");
  const [scanContext, setScanContext] = useState<ScanContext | null>(null);
  const [scanToast, setScanToast] = useState<{ ok: boolean; text: string; key: number } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);

  // The server cache can finish hydrating the entries log just after this
  // screen mounts (notably on a hard reload) — mirror the store's pattern
  // and pick those entries up instead of freezing the first empty snapshot.
  useEffect(() => {
    const read = () => setEntries(loadStockEntries());
    read();
    window.addEventListener("pos-entries-changed", read);
    const t = setInterval(read, 3000);
    return () => { window.removeEventListener("pos-entries-changed", read); clearInterval(t); };
  }, []);

  // Exact balances for THIS screen come from the stock-granted inventory
  // endpoint. The shared catalogue cache is public-safe (stock 1/0) until a
  // staff session exists, which would otherwise leave the keeper looking at
  // availability flags instead of real quantities.
  useEffect(() => {
    if (!member?.id) return;
    let cancelled = false;
    apiGet<{ menu: MenuItem[]; items: GroceryItem[] }>("/staff/inventory")
      .then((r) => {
        if (cancelled) return;
        setMenuState(r.menu);
        setGroceryState(r.items);
      })
      .catch(() => { /* keep the cached snapshot if the fetch fails */ });
    return () => { cancelled = true; };
  }, [member?.id]);

  const views: StockView[] = useMemo(() => {
    if (inv === "canteen") {
      return menu.map((m) => {
        const th = m.lowStock ?? 5;
        const st = m.stock ?? 0;
        return { id: m.id, name: m.name, emoji: m.emoji, unitLabel: "pcs", step: 1, stock: st, price: m.price, threshold: th, low: st <= th, codeLabel: m.category };
      });
    }
    const heads = loadGroceryHeads();
    return grocery.map((g) => {
      const th = g.lowStock ?? (g.unit === "kg" ? 2 : 5);
      const headName = heads.find((h) => h.id === g.headId)?.name;
      return {
        id: g.id, name: g.name, emoji: g.emoji, unitLabel: g.unit === "kg" ? "kg" : "pcs",
        step: g.unit === "kg" ? 0.5 : 1, stock: g.stock, price: g.retailPrice, threshold: th,
        low: g.stock <= th, codeLabel: `SKU ${g.sku}${g.barcode ? ` · 🏷️ ${g.barcode}` : ""}${headName ? ` · ${headName}` : ""}`,
      };
    });
  }, [inv, menu, grocery]);

  const lowCount = views.filter((v) => v.low).length;
  const totalLow = useMemo(() => {
    const c = menu.filter((m) => (m.stock ?? 0) <= (m.lowStock ?? 5)).length;
    const g = grocery.filter((x) => x.stock <= (x.lowStock ?? (x.unit === "kg" ? 2 : 5))).length;
    return c + g;
  }, [menu, grocery]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return views;
    return views.filter((v) => {
      if (v.name.toLowerCase().includes(q) || v.codeLabel.toLowerCase().includes(q)) return true;
      if (inv === "grocery") {
        const g = grocery.find((x) => x.id === v.id);
        if (g && (g.sku === q || (g.barcode && g.barcode === q))) return true;
      }
      return false;
    });
  }, [views, query, inv, grocery]);

  const selected = views.find((v) => v.id === selId) ?? null;

  // Canteen setup mein OFF ho to inventory hamesha grocery rehti hai.
  useEffect(() => {
    if (!shop.hasCanteen && inv !== "grocery") setInv("grocery");
  }, [shop.hasCanteen, inv]);

  // ⏰ Expiry Qareeb — medical setup mein: har product ki sab se qareeb
  // recorded expiry (stock-IN entries se) jo 30 din ke andar ya guzar
  // chuki ho. NOTE: ye sirf WARNING hai — batch-wise deduction (konsi
  // batch ki dawai pehle biki) is version mein track nahi hoti.
  const expiryWarnings = medical ? expiringProducts(grocery, entries) : [];

  // ── Barcode scanner (hardware HID + page-level burst listening) ────────
  // Same scan discipline as Grocery POS: one lookup order — a variant
  // packing's own EAN first, then the product barcode, then SKU/PLU. The
  // catalogue here is the server-hydrated one, so the stock keeper resolves
  // exactly the products the counter sells. A scan only SELECTS a product;
  // quantity, purchase rate and supplier stay manual, and prices remain
  // owner-only (nothing here can create or edit a product).
  const scanSelectRef = useRef<(code: string) => boolean>(() => false);
  scanSelectRef.current = (code: string) => scanSelect(code);
  // Scanner Test panel — khula ho to bursts sirf test ko jayein, product
  // select na ho (ek scan, ek asar).
  const [scannerTestOpen, setScannerTestOpen] = useState(false);
  const scannerTestOpenRef = useRef(false);
  scannerTestOpenRef.current = scannerTestOpen;
  // Camera scanning (getUserMedia + built-in BarcodeDetector, Chrome/Android)
  // — Grocery POS wali hi implementation: phone/tablet ka camera hi scanner
  // ban jata hai, alag barcode scanner kharidna lazmi nahi.
  const [camOpen, setCamOpen] = useState(false);
  const [camMsg, setCamMsg] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const camTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastCamCodeRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  useEffect(() => { scanRef.current?.focus(); }, []);

  useEffect(() => {
    if (!scanToast) return;
    const id = setTimeout(() => setScanToast(null), 2200);
    return () => clearTimeout(id);
  }, [scanToast]);

  // USB/Bluetooth scanners "type" the code very fast and finish with Enter.
  // Like Grocery POS, bursts are captured only when NO field has focus —
  // typing in quantity/rate/supplier/search is never hijacked.
  useEffect(() => {
    let buf = "";
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      if (scannerTestOpenRef.current) return; // test panel khula hai — burst us ka hai
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const now = performance.now();
      if (now - last > 60) buf = "";
      last = now;
      if (e.key === "Enter") {
        if (buf.length >= 3) scanSelectRef.current(buf);
        buf = "";
      } else if (e.key.length === 1) {
        buf += e.key;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Camera scanning (getUserMedia + built-in BarcodeDetector, Chrome/Android)
  // — Grocery POS se mirror ki hui implementation. Detected code wohi
  // scanSelect path leta hai jo physical scanner leta hai (packing EAN →
  // product barcode → SKU), taake ek scan ka ek hi asar ho. Scanner Test
  // panel khula ho to camera bhi khamosh rehta hai — test wala scan product
  // select nahi karta (burst listener wali hi stand-down discipline).
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
          if (scannerTestOpenRef.current) return; // test panel khula hai — scan us ka hai
          try {
            const codes = await detector.detect(v);
            const raw = codes?.[0]?.rawValue?.trim();
            if (raw) {
              const now = Date.now();
              // 1.5s cooldown per code so holding one product doesn't re-select 20×
              if (!(lastCamCodeRef.current.code === raw && now - lastCamCodeRef.current.at < 1500)) {
                lastCamCodeRef.current = { code: raw, at: now };
                scanSelectRef.current(raw);
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

  // Tiny WebAudio beep — same pattern as Grocery POS (success = short high
  // blip, not-found = low buzz). Wrapped so audio can never break an entry.
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

  function selectScanned(item: GroceryItem, context: Omit<ScanContext, "itemId"> | null) {
    setInv("grocery");
    setSelId(item.id);
    setScanContext(context ? { ...context, itemId: item.id } : null);
    setMsg(null);
    beep(true);
    const contextLabel = context
      ? `${context.variantName ? `${context.variantName} · ` : ""}${context.packingLabel}`
      : null;
    showScanToast(true, contextLabel ? `✓ Selected: ${item.name} (${contextLabel})` : `✓ Selected: ${item.name}`);
    // The keeper's next keystrokes are the quantity — land them there.
    setTimeout(() => qtyRef.current?.focus(), 40);
  }

  function scanSelect(raw: string): boolean {
    const code = raw.trim();
    if (!code) return false;
    // 1) A packing's OWN EAN (under any variant, incl. "Standard").
    for (const item of grocery) {
      for (const variant of item.variants ?? []) {
        const packing = variant.packings.find((k) => k.barcode && k.barcode === code);
        if (packing) {
          selectScanned(item, {
            code,
            ...(variant.name !== "Standard" ? { variantName: variant.name } : {}),
            packingLabel: packing.label,
            ...(packing.containsQty ? { containsQty: packing.containsQty } : {}),
          });
          return true;
        }
      }
      // Standard-variant packings are also mirrored on item.packings.
      const packing = (item.packings ?? []).find((k) => k.barcode && k.barcode === code);
      if (packing) {
        selectScanned(item, {
          code,
          packingLabel: packing.label,
          ...(packing.containsQty ? { containsQty: packing.containsQty } : {}),
        });
        return true;
      }
    }
    // 2) Product barcode, then 3) SKU/PLU — the server lookup's order.
    const found = grocery.find((x) => x.barcode && x.barcode === code) || grocery.find((x) => x.sku === code);
    if (found) {
      selectScanned(found, null);
      return true;
    }
    beep(false);
    const text = `✕ Product nahi mila — code ${code}. Ye product system mein nahi hai; pehle Owner ko Dashboard se ye product add karna hoga.`;
    setMsg({ ok: false, text });
    showScanToast(false, text);
    setTimeout(() => scanRef.current?.focus(), 40);
    return false;
  }

  function submitScan(e: React.FormEvent) {
    e.preventDefault();
    scanSelect(scanCode);
    setScanCode("");
  }

  function jumpToCode() {
    // Enter in the search box: an exact barcode/SKU selects the item directly.
    const q = query.trim();
    if (!q || inv !== "grocery") return;
    const g = grocery.find((x) => x.barcode === q || x.sku === q);
    if (g) { setSelId(g.id); setScanContext(null); setMsg(null); }
  }

  function saveEntry() {
    if (!selected) { setMsg({ ok: false, text: "Pehle list se item chunein 👈" }); return; }
    const q = parseFloat(qty);
    if (isNaN(q) || q <= 0) { setMsg({ ok: false, text: "Sahi quantity likhein" }); return; }
    let rateNum: number | undefined;
    if (mode === "add") {
      rateNum = parseFloat(rate);
      if (isNaN(rateNum) || rateNum <= 0) { setMsg({ ok: false, text: "Purchase rate (Rs) likhein — stock-in entry ke liye lazmi hai" }); return; }
    }
    // Stock is kept as ONE product-level pool of base units. When the entry
    // was scanned from a packing, the typed quantity counts THAT packing —
    // a Full Dabba of 6 adds 6 base packs per dabba typed.
    const activeScan = inv === "grocery" && scanContext && scanContext.itemId === selected.id ? scanContext : null;
    const contains = activeScan?.containsQty && activeScan.containsQty > 0 ? activeScan.containsQty : 1;
    const entryQty = round1(q * contains);
    if (mode === "wastage" && entryQty > selected.stock) {
      setMsg({ ok: false, text: `Stock sirf ${fmtQty(selected.stock)} ${selected.unitLabel} hai — is se zyada wastage nahi ho sakti` });
      return;
    }
    const delta = mode === "add" ? entryQty : -entryQty;
    if (inv === "canteen") {
      const next = menu.map((m) => (m.id === selected.id ? { ...m, stock: Math.max(0, round1((m.stock ?? 0) + delta)) } : m));
      setMenuState(next); saveMenu(next);
    } else {
      const next = grocery.map((g) => (g.id === selected.id ? { ...g, stock: Math.max(0, round1(g.stock + delta)) } : g));
      setGroceryState(next); saveGrocery(next);
    }
    const entry: StockEntry = {
      id: `se-${Date.now()}`,
      at: new Date().toISOString(),
      kind: inv,
      itemId: selected.id,
      itemName: selected.name,
      type: mode,
      qty: entryQty,
      unit: selected.unitLabel,
      rate: mode === "add" ? rateNum : undefined,
      supplier: mode === "add" ? (supplier.trim() || undefined) : undefined,
      reason: mode === "wastage" ? reason : undefined,
      // Medical: dawai ki expiry is stock-IN batch ke sath save hoti hai
      expiry: mode === "add" && inv === "grocery" && medical && expiry ? expiry : undefined,
      by: member?.name ?? "Staff",
    };
    const nextEntries = [entry, ...entries];
    setEntries(nextEntries); saveStockEntries(nextEntries);
    setQty(""); setRate(""); setSupplier(""); setExpiry("");
    const conversionNote = activeScan && contains !== 1
      ? ` (${fmtQty(q)} × ${activeScan.packingLabel} × ${fmtQty(contains)} base)`
      : activeScan ? ` (${activeScan.variantName ? `${activeScan.variantName} · ` : ""}${activeScan.packingLabel})` : "";
    setMsg({ ok: true, text: mode === "add" ? `✓ Stock IN: ${selected.name} +${fmtQty(entryQty)} ${selected.unitLabel}${conversionNote}` : `✓ Wastage: ${selected.name} −${fmtQty(entryQty)} ${selected.unitLabel} (${reason})${conversionNote}` });
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar />
      <div className="px-4 py-1.5 text-xs font-bold text-stone-500 bg-orange-100/60 flex justify-between">
        <span>📦 STOCK — sirf entries (stock in / wastage), selling NAHI hoti yahan</span>
        <span style={{ color: totalLow > 0 ? "#DC2626" : "#16A34A" }}>⚠️ Low stock: {totalLow} items</span>
      </div>

      <main className="p-4 space-y-4 max-w-6xl mx-auto w-full">
        {/* Inventory switch */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-2xl overflow-hidden border-2 border-stone-200">
            {shop.hasCanteen && (
              <button onClick={() => { setInv("canteen"); setSelId(null); setScanContext(null); setMsg(null); }} className="px-6 py-3 font-extrabold"
                style={inv === "canteen" ? { background: "#F97316", color: "#fff" } : { background: "#fff", color: "#44403C" }}>🍽️ Canteen Stock</button>
            )}
            <button onClick={() => { setInv("grocery"); setSelId(null); setScanContext(null); setMsg(null); }} className="px-6 py-3 font-extrabold"
              style={inv === "grocery" ? { background: "#F97316", color: "#fff" } : { background: "#fff", color: "#44403C" }}>🛒 Grocery Stock</button>
          </div>
          {lowCount > 0 && (
            <span className="rounded-full px-3.5 py-1.5 text-sm font-black text-white" style={{ background: "#DC2626" }}>
              ⚠️ {lowCount} item{lowCount > 1 ? "s" : ""} low stock par hain — neeche list mein red/amber dekhein
            </span>
          )}
          <span className="text-sm font-bold text-stone-400">Prices yahan sirf dikhte hain — price badalna Owner ka kaam hai.</span>
        </div>

        {/* ⏰ Expiry Qareeb — sirf Medical Store setup mein */}
        {medical && (
          <section className="bg-white rounded-2xl border-2 border-amber-200 shadow-sm p-4" data-testid="expiry-warning-panel">
            <h2 className="font-extrabold">⏰ Expiry Qareeb — Dawaiyan</h2>
            <p className="text-xs font-bold text-stone-400 mb-3">
              Jin dawaiyon ki kisi stock-IN entry ki expiry 30 din ke andar hai ya guzar chuki hai.
              NOTE: ye sirf warning hai — batch-wise hisaab (konsi batch ki dawai pehle biki) is version mein nahi hai; expiry wali dawai pehle nikaalna staff ki zimmedari hai.
            </p>
            {expiryWarnings.length === 0 ? (
              <p className="text-sm font-bold text-stone-400">✓ Abhi koi dawai expiry ke qareeb nahi (ya kisi entry mein expiry nahi di gayi).</p>
            ) : (
              <ul className="space-y-1.5">
                {expiryWarnings.map((w) => (
                  <li key={w.item.id} data-testid="expiry-warning-row" className="flex items-center gap-2.5 rounded-xl border px-3 py-2"
                    style={{ borderColor: w.daysLeft < 0 ? "#FECACA" : "#FDE68A", background: w.daysLeft < 0 ? "#FEF2F2" : "#FFFBEB" }}>
                    <span className="text-2xl">{w.item.emoji}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-bold text-sm leading-snug">{w.item.name}</span>
                      <span className="block text-xs text-stone-500">Expiry: {expiryLabel(w.expiry)} · Stock {fmtQty(w.item.stock)} {w.item.unit === "kg" ? "kg" : "pcs"}</span>
                    </span>
                    <span className="font-black text-sm shrink-0" style={{ color: w.daysLeft < 0 ? "#DC2626" : "#D97706" }}>
                      {w.daysLeft < 0 ? `⚠️ EXPIRED ${-w.daysLeft} din pehle` : `⏰ ${w.daysLeft} din baqi`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {/* ── Entry form + item picker ── */}
          <section className="min-w-0 bg-white rounded-2xl border border-orange-100 shadow-sm p-4">
            {/* Barcode scan — shared by Stock IN and Wastage because both use
                the same selected product below. */}
            <form onSubmit={submitScan} className="mb-3 rounded-2xl border-2 border-green-200 bg-green-50/60 p-3">
              <label className="block">
                <span className="text-xs font-extrabold text-stone-500">BARCODE SCAN — GROCERY PRODUCT SELECT KAREIN</span>
                <span className="mt-1 flex gap-2">
                  <input ref={scanRef} value={scanCode} onChange={(e) => setScanCode(e.target.value)}
                    placeholder="🔫 Barcode scan karein ya code likh kar Enter"
                    data-testid="stock-scan-input"
                    className="min-w-0 flex-1 rounded-xl border-2 border-stone-200 bg-white px-3 py-3 font-bold outline-none focus:border-green-600" />
                  <button type="submit" className="shrink-0 rounded-xl px-4 py-3 font-extrabold text-white" style={{ background: "#16A34A" }}>Select</button>
                </span>
              </label>
              <p className="mt-2 text-xs font-bold text-stone-500">
                Scan hote hi product select ho jayega — Quantity, Purchase Rate aur Supplier aap khud likhenge.
                Product system mein na ho to pehle Owner ko Dashboard se add karna hoga; Stock Wala product ya price nahi bana sakta.
              </p>
              <button type="button" onClick={() => setScannerTestOpen((v) => !v)} data-testid="scanner-test-toggle"
                className="mt-2 rounded-xl px-4 py-2 font-extrabold text-white" style={{ background: "#78716C" }}>
                🔫 Scanner Test — scanner check karein
              </button>
              <button type="button" onClick={() => (camOpen ? closeCamera() : openCamera())} data-testid="stock-camera-toggle"
                className="mt-2 ml-2 rounded-xl px-4 py-2 font-extrabold text-white" style={{ background: "#1976D2" }}>
                📷 Camera se Scan
              </button>
            </form>
            {scannerTestOpen && (
              <div className="mb-3 rounded-2xl bg-white p-1">
                <ScannerTest />
              </div>
            )}
            {/* Camera scan panel — getUserMedia + BarcodeDetector (Chrome/Android).
                Phone/tablet ka camera hi scanner hai; detected code wohi
                scanSelect path leta hai jo physical scanner leta hai. */}
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
                <p className="text-xs opacity-70 mt-2">Scan hote hi product select ho jayega — camera khula rahega, agla item scan karein.</p>
              </div>
            )}

            <div className="flex rounded-xl overflow-hidden border-2 border-stone-200 mb-3">
              <button onClick={() => setMode("add")} className="flex-1 py-3 font-extrabold"
                style={mode === "add" ? { background: "#16A34A", color: "#fff" } : { background: "#fff", color: "#44403C" }}>➕ Stock IN (kharid)</button>
              <button onClick={() => setMode("wastage")} className="flex-1 py-3 font-extrabold"
                style={mode === "wastage" ? { background: "#DC2626", color: "#fff" } : { background: "#fff", color: "#44403C" }}>🗑️ Wastage (zaya)</button>
            </div>

            <input value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") jumpToCode(); }}
              placeholder={inv === "grocery" ? "🔍 Item ka naam, ya barcode/SKU likh kar Enter — item select ho jayega" : "🔍 Item ka naam likhein…"}
              className="w-full rounded-xl border-2 border-stone-200 px-4 py-3 text-base outline-none focus:border-orange-500 mb-2" />
            <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
              {filtered.map((v) => {
                const sel = selId === v.id;
                return (
                  <button key={v.id} onClick={() => { setSelId(v.id); setScanContext(null); setMsg(null); }}
                    className="w-full flex items-center gap-2.5 rounded-xl border-2 px-3 py-2 text-left transition active:scale-[0.99]"
                    style={sel ? { borderColor: "#F97316", background: "#FFF7ED" } : { borderColor: v.low ? "#F59E0B" : "#F5F5F4", background: v.low ? "#FFFBEB" : "#fff" }}>
                    <span className="text-2xl">{v.emoji}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-bold text-sm truncate">{v.name}</span>
                      <span className="block text-xs text-stone-500">{v.codeLabel} · Sale Rs {v.price} <span className="text-stone-300">(sirf dikh raha hai)</span></span>
                    </span>
                    {v.low && <span className="text-[10px] font-black rounded-full px-2 py-0.5 text-white shrink-0" style={{ background: v.stock <= 0 ? "#DC2626" : "#F59E0B" }}>{v.stock <= 0 ? "KHATAM" : "LOW"}</span>}
                    <span className="text-right shrink-0">
                      <span className="block font-black" style={{ color: v.low ? "#DC2626" : "#16A34A" }}>{fmtQty(v.stock)}</span>
                      <span className="block text-[10px] font-bold text-stone-400">{v.unitLabel} · low ≤ {v.threshold}</span>
                    </span>
                  </button>
                );
              })}
              {filtered.length === 0 && <p className="text-stone-400 text-center py-6">Koi item nahi mila.</p>}
            </div>

            {selected && (
              <div className="mt-3 rounded-xl bg-orange-50/70 border border-orange-100 px-3 py-2 font-bold text-sm" data-testid="stock-selected">
                Selected: <b>{selected.emoji} {selected.name}</b> — mojooda stock <b>{fmtQty(selected.stock)} {selected.unitLabel}</b>
                {inv === "grocery" && scanContext && scanContext.itemId === selected.id && (
                  <span className="block mt-1 text-green-700">
                    🔫 Scanned packing: <b>{scanContext.variantName ? `${scanContext.variantName} · ` : ""}{scanContext.packingLabel}</b>
                    {scanContext.containsQty && scanContext.containsQty !== 1
                      ? <> — Quantity is packing mein likhein; 1 packing = {fmtQty(scanContext.containsQty)} base {selected.unitLabel}, entry product ke shared stock pool mein base quantity se save hogi.</>
                      : <> — stock product ke shared pool mein count hoga.</>}
                  </span>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 mt-3">
              <label className="block">
                <span className="text-xs font-extrabold text-stone-500">QUANTITY ({inv === "grocery" && scanContext && selected && scanContext.itemId === selected.id ? `${scanContext.packingLabel} packs` : selected?.unitLabel ?? "pcs"})</span>
                <input ref={qtyRef} value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" placeholder={selected ? `step ${selected.step}` : "0"} data-testid="stock-qty-input"
                  className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-3 text-lg font-bold outline-none focus:border-orange-500" />
              </label>
              {mode === "add" ? (
                <label className="block">
                  <span className="text-xs font-extrabold text-stone-500">PURCHASE RATE (Rs)</span>
                  <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="0"
                    className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-3 text-lg font-bold outline-none focus:border-orange-500" />
                </label>
              ) : (
                <label className="block">
                  <span className="text-xs font-extrabold text-stone-500">REASON (wajah)</span>
                  <select value={reason} onChange={(e) => setReason(e.target.value)}
                    className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-3 text-lg font-bold outline-none bg-white">
                    <option>Expired</option>
                    <option>Damaged</option>
                    <option>Spilled</option>
                    <option>Other</option>
                  </select>
                </label>
              )}
            </div>
            {mode === "add" && (
              <label className="block mt-2">
                <span className="text-xs font-extrabold text-stone-500">SUPPLIER (optional)</span>
                <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. Lahore Traders"
                  className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-3 font-bold outline-none focus:border-orange-500" />
              </label>
            )}
            {mode === "add" && inv === "grocery" && medical && (
              <label className="block mt-2">
                <span className="text-xs font-extrabold text-stone-500">EXPIRY — DAWAI KI EXPIRY (mahina / saal)</span>
                <input type="month" value={expiry} onChange={(e) => setExpiry(e.target.value)} data-testid="stock-expiry-input"
                  className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-3 font-bold outline-none focus:border-orange-500 bg-white" />
                <span className="block mt-1 text-xs font-bold text-stone-400">Ye batch kab expire hoga — expiry qareeb ane par ⏰ warning list mein ayega.</span>
              </label>
            )}
            {msg && <p className="mt-3 font-bold text-sm" style={{ color: msg.ok ? "#16A34A" : "#DC2626" }}>{msg.text}</p>}
            <button onClick={saveEntry} data-testid="stock-save-entry" className="mt-3 w-full rounded-2xl py-4 text-xl font-black text-white active:scale-[0.99]"
              style={{ background: mode === "add" ? "#16A34A" : "#DC2626" }}>
              {mode === "add" ? "➕ Stock IN — Save Entry" : "🗑️ Wastage — Save Entry"}
            </button>
          </section>

          {/* ── Entries log ── */}
          <section className="min-w-0 bg-white rounded-2xl border border-orange-100 shadow-sm p-4">
            <h2 className="font-extrabold mb-1">🧾 Stock Entries — Recent</h2>
            <p className="text-xs font-bold text-stone-400 mb-3">Har entry par: item, quantity, rate/supplier ya wajah, kis ne ki aur kab. (Sales yahan nahi aati — woh POS se stock khud kam karti hain.)</p>
            {entries.length === 0 && <p className="text-stone-400 py-8 text-center">Abhi koi stock entry nahi. Pehli entry left side se karein 👈</p>}
            <ul className="space-y-1.5 max-h-[560px] overflow-y-auto pr-1">
              {entries.slice(0, 30).map((e) => (
                <li key={e.id} className="flex items-center gap-2.5 rounded-xl border border-stone-100 bg-orange-50/40 px-3 py-2">
                  <span className="inline-flex items-center justify-center w-9 h-9 rounded-full text-white font-black shrink-0" style={{ background: e.type === "add" ? "#16A34A" : "#DC2626" }}>{e.type === "add" ? "＋" : "🗑"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm truncate">
                      {e.itemName} <span style={{ color: e.type === "add" ? "#16A34A" : "#DC2626" }}>{e.type === "add" ? "+" : "−"}{fmtQty(e.qty)} {e.unit}</span>
                      <span className="ml-1.5 text-[10px] font-black rounded-full px-2 py-0.5 text-white" style={{ background: e.kind === "grocery" ? "#388E3C" : "#F97316" }}>{e.kind === "grocery" ? "🛒 GROCERY" : "🍽️ CANTEEN"}</span>
                    </div>
                    <div className="text-xs text-stone-500">
                      {e.type === "add" ? <>Rate Rs {e.rate}{e.supplier ? ` · ${e.supplier}` : ""}</> : <>Wajah: {e.reason}</>}
                      {e.expiry ? <> · ⏰ Exp {expiryLabel(e.expiry)}</> : null}
                      {" · "}👤 {e.by} · {new Date(e.at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Full stock list — both inventories at a glance */}
        <section className="bg-white rounded-2xl border border-orange-100 shadow-sm p-4">
          <h2 className="font-extrabold mb-3">📋 Mojooda Stock — {inv === "canteen" ? "🍽️ Canteen" : "🛒 Grocery"} <span className="text-xs font-bold text-stone-400">(jo item low threshold par ya neeche hai woh amber/red hai)</span></h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {views.map((v) => (
              <div key={v.id} className="flex items-center gap-2 rounded-xl border px-3 py-2"
                style={{ borderColor: v.low ? "#F59E0B" : "#F5F5F4", background: v.low ? "#FFFBEB" : "#fff" }}>
                <span className="text-2xl">{v.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm truncate">{v.name}</div>
                  <div className="text-xs text-stone-500">{v.codeLabel}</div>
                </div>
                <div className="text-right">
                  <div className="font-black" style={{ color: v.stock <= 0 ? "#DC2626" : v.low ? "#D97706" : "#16A34A" }}>{fmtQty(v.stock)} <span className="text-xs">{v.unitLabel}</span></div>
                  <div className="text-[10px] font-bold text-stone-400">low ≤ {v.threshold}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {scanToast && (
        <div key={scanToast.key} data-testid="stock-scan-toast"
          className={`fixed left-1/2 bottom-6 z-[70] w-[min(92vw,720px)] -translate-x-1/2 rounded-2xl px-5 py-3 text-center text-base font-black text-white shadow-2xl pop-in ${scanToast.ok ? "" : "shake"}`}
          style={{ background: scanToast.ok ? "#16A34A" : "#DC2626" }}>
          {scanToast.text}
        </div>
      )}
    </div>
  );
}

// Staff side — role-gated: only staff whose tabs include Stock see this.
// Business gate: retail setup mein off ho to RetailOnly notice deta hai
// (stock tab khud retail par band hai; ye andar ka doosra darwaza hai).
export default function StockPage() {
  return (
    <StaffGate tab="stock">
      <RetailOnly what="Stock">
        <StockScreen />
      </RetailOnly>
    </StaffGate>
  );
}
