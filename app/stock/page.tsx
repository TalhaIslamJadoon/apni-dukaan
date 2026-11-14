"use client";

import { useMemo, useState } from "react";
import TopBar from "@/components/TopBar";
import StaffGate from "@/components/StaffGate";
import {
  GroceryItem, MenuItem, StockEntry,
  loadMenu, saveMenu, loadGrocery, saveGrocery, loadGroceryHeads, loadStockEntries, saveStockEntries, useStaffSession,
} from "@/lib/store";

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

const round1 = (n: number) => Math.round(n * 10) / 10;
const fmtQty = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(1));

function StockScreen() {
  const member = useStaffSession();
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

  function jumpToCode() {
    // Enter in the search box: an exact barcode/SKU selects the item directly.
    const q = query.trim();
    if (!q || inv !== "grocery") return;
    const g = grocery.find((x) => x.barcode === q || x.sku === q);
    if (g) { setSelId(g.id); setMsg(null); }
  }

  function saveEntry() {
    if (!selected) { setMsg({ ok: false, text: "Pehle list se item chunein 👈" }); return; }
    const q = parseFloat(qty);
    if (isNaN(q) || q <= 0) { setMsg({ ok: false, text: "Sahi quantity likhein" }); return; }
    let rateNum: number | undefined;
    if (mode === "add") {
      rateNum = parseFloat(rate);
      if (isNaN(rateNum) || rateNum <= 0) { setMsg({ ok: false, text: "Purchase rate (Rs) likhein — stock-in entry ke liye lazmi hai" }); return; }
    } else if (q > selected.stock) {
      setMsg({ ok: false, text: `Stock sirf ${fmtQty(selected.stock)} ${selected.unitLabel} hai — is se zyada wastage nahi ho sakti` });
      return;
    }
    const delta = mode === "add" ? q : -q;
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
      qty: q,
      unit: selected.unitLabel,
      rate: mode === "add" ? rateNum : undefined,
      supplier: mode === "add" ? (supplier.trim() || undefined) : undefined,
      reason: mode === "wastage" ? reason : undefined,
      by: member?.name ?? "Staff",
    };
    const nextEntries = [entry, ...entries];
    setEntries(nextEntries); saveStockEntries(nextEntries);
    setQty(""); setRate(""); setSupplier("");
    setMsg({ ok: true, text: mode === "add" ? `✓ Stock IN: ${selected.name} +${fmtQty(q)} ${selected.unitLabel}` : `✓ Wastage: ${selected.name} −${fmtQty(q)} ${selected.unitLabel} (${reason})` });
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
            <button onClick={() => { setInv("canteen"); setSelId(null); setMsg(null); }} className="px-6 py-3 font-extrabold"
              style={inv === "canteen" ? { background: "#F97316", color: "#fff" } : { background: "#fff", color: "#44403C" }}>🍽️ Canteen Stock</button>
            <button onClick={() => { setInv("grocery"); setSelId(null); setMsg(null); }} className="px-6 py-3 font-extrabold"
              style={inv === "grocery" ? { background: "#F97316", color: "#fff" } : { background: "#fff", color: "#44403C" }}>🛒 Grocery Stock</button>
          </div>
          {lowCount > 0 && (
            <span className="rounded-full px-3.5 py-1.5 text-sm font-black text-white" style={{ background: "#DC2626" }}>
              ⚠️ {lowCount} item{lowCount > 1 ? "s" : ""} low stock par hain — neeche list mein red/amber dekhein
            </span>
          )}
          <span className="text-sm font-bold text-stone-400">Prices yahan sirf dikhte hain — price badalna Owner ka kaam hai.</span>
        </div>

        <div className="grid lg:grid-cols-2 gap-4 items-start">
          {/* ── Entry form + item picker ── */}
          <section className="bg-white rounded-2xl border border-orange-100 shadow-sm p-4">
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
                  <button key={v.id} onClick={() => { setSelId(v.id); setMsg(null); }}
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
              <div className="mt-3 rounded-xl bg-orange-50/70 border border-orange-100 px-3 py-2 font-bold text-sm">
                Selected: <b>{selected.emoji} {selected.name}</b> — mojooda stock <b>{fmtQty(selected.stock)} {selected.unitLabel}</b>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 mt-3">
              <label className="block">
                <span className="text-xs font-extrabold text-stone-500">QUANTITY ({selected?.unitLabel ?? "pcs"})</span>
                <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" placeholder={selected ? `step ${selected.step}` : "0"}
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
            {msg && <p className="mt-3 font-bold text-sm" style={{ color: msg.ok ? "#16A34A" : "#DC2626" }}>{msg.text}</p>}
            <button onClick={saveEntry} className="mt-3 w-full rounded-2xl py-4 text-xl font-black text-white active:scale-[0.99]"
              style={{ background: mode === "add" ? "#16A34A" : "#DC2626" }}>
              {mode === "add" ? "➕ Stock IN — Save Entry" : "🗑️ Wastage — Save Entry"}
            </button>
          </section>

          {/* ── Entries log ── */}
          <section className="bg-white rounded-2xl border border-orange-100 shadow-sm p-4">
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
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
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
    </div>
  );
}

// Staff side — role-gated: only staff whose tabs include Stock see this.
export default function StockPage() {
  return (
    <StaffGate tab="stock">
      <StockScreen />
    </StaffGate>
  );
}
