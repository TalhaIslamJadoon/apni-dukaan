"use client";

import { useEffect, useMemo, useState } from "react";
import TopBar from "@/components/TopBar";
import StaffGate from "@/components/StaffGate";
import OrderAlerts from "@/components/OrderAlerts";
import Receipt from "@/components/Receipt";
import QRCode from "react-qr-code";
import Barcode128 from "@/components/Barcode128";
import { GuidelineButton, GuidelineIndexButton } from "@/components/Guideline";
import UdhaarKhataSection from "@/components/UdhaarKhata";
import MerchantQrSection from "@/components/MerchantQr";
import Link from "next/link";
import {
  CATEGORIES, Category, Deal, Expense, GroceryHead, GroceryItem, GrocerySubHead, MenuItem, Order, StaffMember, TabKey, TABS_META,
  loadMenu, saveMenu, loadOrders, saveOrders, isToday, nextToken, adjustStockForOrder, loadGrocery, saveGrocery, loadGroceryHeads, saveGroceryHeads, loadGrocerySubHeads, saveGrocerySubHeads, billNoOf,
  loadShop, saveShop, useShop, ShopSettings, SHOP_DEFAULTS, loadStaff, saveStaff, offerActive,
  loadDeals, saveDeals, dealValue, dealContentsText, loadExpenses, saveExpenses, expiringProducts, expiryLabel, loadStockEntries, hasRetail,
} from "@/lib/store";
import { templateOf } from "@/lib/templates";
import { apiGet, apiPost } from "@/lib/api";

// Emoji choices for a NEW grocery head (owner picks one from this row).
const HEAD_EMOJIS = ["🌾", "🫙", "☕", "🥛", "🍪", "🧼", "🧴", "🥐", "🧊", "🏠", "🥤", "🍫", "👶", "🥜", "🌶️", "🛒"];
// Pastel tints handed out to owner-added heads (same family as the seeds).
const HEAD_TINTS = ["#FFFBEB", "#EFF6FF", "#F0FDF4", "#FDF2F8", "#F5F3FF", "#FFF7ED", "#ECFEFF", "#FEF2F2"];
// URL-ish slug for owner-created head / sub-head ids.
const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";

// Simple count-up feel for KPI numbers (plain JS rAF, no library).
function AnimNum({ value, prefix = "" }: { value: number; prefix?: string }) {
  const [disp, setDisp] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const dur = 650;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      setDisp(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{prefix}{disp.toLocaleString()}</>;
}

// ── Staff Access — the OWNER assigns who sees which tabs ────────────────────
// Talha's rule: "Jis banday ko jis chez ka access ho usy just uska tab show
// ho — owner role assign kar saky." Add / edit / remove staff, set each
// person's PIN and tick their tabs (a person may hold several). The owner
// record is protected: it cannot be removed and can never lose the Owner
// tab, so the shop can never lock itself out of its own dashboard.
function StaffAccessSection() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<{ name: string; pin: string; tabs: TabKey[] }>({ name: "", pin: "", tabs: [] });
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const read = () => setStaff(loadStaff());
    read();
    window.addEventListener("staff-updated", read);
    return () => window.removeEventListener("staff-updated", read);
  }, []);

  const editing = staff.find((s) => s.id === editingId) ?? null;

  function toggleTab(key: TabKey) {
    if (editing?.isOwner && key === "owner") return; // owner's Owner tab is locked ON
    setForm((f) => ({ ...f, tabs: f.tabs.includes(key) ? f.tabs.filter((t) => t !== key) : [...f.tabs, key] }));
  }
  function startEdit(m: StaffMember) {
    setEditingId(m.id);
    setForm({ name: m.name, pin: m.pin, tabs: [...m.tabs] });
    setMsg("");
  }
  function resetForm() { setEditingId(null); setForm({ name: "", pin: "", tabs: [] }); }
  function save() {
    const name = form.name.trim();
    if (!name) { setMsg("⚠️ Naam likhein"); return; }
    if (!/^\d{4}$/.test(form.pin)) { setMsg("⚠️ PIN theek 4 digits ka hona chahiye"); return; }
    if (form.tabs.length === 0) { setMsg("⚠️ Kam az kam ek tab tick karein"); return; }
    let next: StaffMember[];
    if (editing) {
      const tabs = editing.isOwner ? Array.from(new Set<TabKey>([...form.tabs, "owner"])) : form.tabs;
      next = staff.map((s) => (s.id === editing.id ? { ...s, name, pin: form.pin, tabs } : s));
      setMsg(`✓ ${name} ka access update ho gaya`);
    } else {
      next = [...staff, { id: `staff-${Date.now()}`, name, pin: form.pin, tabs: form.tabs }];
      setMsg(`✓ ${name} add ho gaya — woh apne naam + naye PIN se login karega`);
    }
    setStaff(next); saveStaff(next);
    resetForm();
  }
  function remove(m: StaffMember) {
    if (m.isOwner) { setMsg("⛔ Owner ko remove nahi kar sakte — warna dashboard hamesha ke liye band ho jayega"); return; }
    if (!window.confirm(`${m.name} ko remove kar dein? Us ka login band ho jayega.`)) return;
    const next = staff.filter((s) => s.id !== m.id);
    setStaff(next); saveStaff(next);
    if (editingId === m.id) resetForm();
    setMsg(`✓ ${m.name} remove ho gaya`);
  }

  return (
    <section className="bg-white rounded-2xl border border-orange-100 shadow-sm p-4">
      <h2 className="font-extrabold mb-1">🔐 Staff Access — Kis Ko Konsa Tab Milega</h2>
      <p className="text-sm text-stone-500 mb-3">Har banday ko <b>sirf usi ke tabs</b> nazar aayenge jo yahan tick hain. Ek banday ko kai tabs bhi de sakte hain (masalan Canteen + Grocery). Naam + PIN se woh login karega.</p>
      <div className="space-y-1.5 mb-4">
        {staff.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-orange-50/60 border border-orange-100 px-3 py-2">
            <span className="text-xl">{m.isOwner ? "👑" : "👤"}</span>
            <span className="font-extrabold">{m.name}</span>
            <span className="text-xs font-bold text-stone-400">PIN ••••</span>
            <span className="flex flex-wrap gap-1">
              {m.tabs.map((k) => {
                const meta = TABS_META.find((t) => t.key === k);
                return <span key={k} className="text-[10px] font-black rounded-full px-2 py-0.5 text-white" style={{ background: "#0F172A" }}>{meta?.emoji} {meta?.short}</span>;
              })}
            </span>
            <span className="ml-auto flex gap-1.5">
              <button onClick={() => startEdit(m)} className="font-bold text-sm px-3 py-1.5 rounded-lg bg-white border border-stone-200">Edit</button>
              {m.isOwner
                ? <span className="text-xs font-bold text-stone-400 self-center">Owner — hamesha rehta hai</span>
                : <button onClick={() => remove(m)} className="font-bold text-sm px-3 py-1.5 rounded-lg text-white" style={{ background: "#DC2626" }}>Remove</button>}
            </span>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border-2 border-dashed border-stone-200 p-3">
        <div className="font-extrabold mb-2">{editing ? `✏️ Edit — ${editing.name}` : "➕ Naya Staff Add Karein"}</div>
        <div className="flex flex-wrap gap-2 mb-2">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Naam (e.g. Ahmed Canteen)" className="rounded-xl border-2 border-stone-200 px-3 py-2.5 flex-1 min-w-[170px] outline-none focus:border-orange-500" />
          <input value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="PIN (4 digits)" inputMode="numeric" className="rounded-xl border-2 border-stone-200 px-3 py-2.5 w-36 outline-none focus:border-orange-500" />
        </div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {TABS_META.map((t) => {
            const on = form.tabs.includes(t.key);
            const locked = !!editing?.isOwner && t.key === "owner";
            return (
              <button key={t.key} onClick={() => toggleTab(t.key)} disabled={locked}
                className="rounded-full px-3.5 py-2 font-extrabold text-sm border-2 transition disabled:opacity-60"
                style={on ? { background: "#F97316", borderColor: "#F97316", color: "#fff" } : { background: "#fff", borderColor: "#E7E5E4", color: "#44403C" }}>
                {on ? "✓ " : ""}{t.label}{locked ? " 🔒" : ""}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={save} className="rounded-xl px-5 py-2.5 font-extrabold text-white" style={{ background: "#16A34A" }}>{editing ? "Save Access" : "+ Add Staff"}</button>
          {editing && <button onClick={resetForm} className="rounded-xl px-4 py-2.5 font-bold bg-stone-100">Cancel</button>}
          {msg && <span className="font-bold text-sm" style={{ color: msg.startsWith("✓") ? "#16A34A" : "#DC2626" }}>{msg}</span>}
        </div>
        <p className="text-xs text-stone-400 mt-2">Apna (Owner) PIN badalne ke liye upar <b>Owner</b> wali row ko Edit karein. ⚠️ Prototype PINs isi device par demo-grade save hote hain — Phase 2 mein asal staff accounts hashed passwords ke sath PostgreSQL par honge.</p>
      </div>
    </section>
  );
}

// ── Online Payment Verification ────────────────────────────────────────────
// Talha's rule: online orders are "payment pehle, order confirm baad mein".
// The customer pays the shop number and uploads a screenshot (proof); the
// order waits as paymentStatus "proof_pending" — OUT of the Kitchen /
// packing queue, with token 0. Here the owner checks the proof:
//  ✅ Confirm → token assigned NOW, order released to Kitchen / packing.
//  ❌ Reject  → reason (customer sees it), stock restored, customer can
//             re-upload a fresh proof from My Orders.
function PaymentVerificationSection({ orders, onDone }: { orders: Order[]; onDone: () => void }) {
  const [zoomProof, setZoomProof] = useState<Order | null>(null);
  const pending = orders
    .filter((o) => o.source === "online" && o.paymentStatus === "proof_pending")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  function confirm(o: Order) {
    const all = loadOrders();
    if (!all.some((x) => x.id === o.id && x.paymentStatus === "proof_pending")) { onDone(); return; }
    const token = nextToken(all, o.mode); // token is assigned at CONFIRMATION time — the order's OWN shop counting
    saveOrders(all.map((x) => (x.id === o.id ? { ...x, paymentStatus: "confirmed" as const, token, rejectReason: undefined } : x)));
    onDone();
  }
  function reject(o: Order) {
    const reason = window.prompt("Reject ki wajah likhein — yeh customer ko dikhe gi:", "");
    if (reason === null) return; // cancelled
    const all = loadOrders();
    const fresh = all.find((x) => x.id === o.id);
    if (!fresh || fresh.paymentStatus !== "proof_pending") { onDone(); return; }
    adjustStockForOrder(fresh, 1); // placement had deducted the stock — give it back
    saveOrders(all.map((x) => (x.id === o.id
      ? { ...x, paymentStatus: "rejected" as const, rejectReason: reason.trim() || "Payment proof qabool nahi — sahi payment karke dobara proof upload karein" }
      : x)));
    onDone();
  }

  return (
    <section className="bg-white rounded-2xl border-2 border-amber-200 shadow-sm p-4" data-testid="payment-verification-panel">
      <h2 className="font-extrabold mb-1">💳 Online Payment Verification — Tasdeeq Baqi ({pending.length})</h2>
      <p className="text-sm text-stone-500 mb-3">Online customers pehle payment karke <b>proof (screenshot)</b> bhejte hain. Jab tak aap confirm na karein, order <b>Kitchen / packing queue mein nahi jata</b> aur us ka token nahi banta. Proof check karke Confirm ya Reject karein.</p>
      {pending.length === 0 && <p className="font-bold" style={{ color: "#16A34A" }}>✅ Koi payment tasdeeq baqi nahi — sab clear hai.</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {pending.map((o) => {
          const proof = o.paymentProof;
          const amountOk = proof ? proof.amount === o.total : false;
          return (
            <div key={o.id} className="rounded-2xl border-2 border-amber-100 bg-amber-50/50 p-3" data-testid="verify-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-black">{o.mode === "grocery" ? "🛒 Grocery" : "🍔 Canteen"} — {o.customerName ?? "Customer"}</div>
                  <div className="text-xs font-bold text-stone-500">
                    {o.orderType === "dine-in" ? `🍽️ Dine-In — Table ${o.tableNo}` : o.placeLabel ?? "Online"} · {o.customerMobile ?? ""} · {billNoOf(o)} · {new Date(o.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xl font-black" style={{ color: "#F97316" }}>Rs {o.total.toLocaleString()}</div>
                  <div className="text-[10px] font-black rounded-full px-2 py-0.5 text-white" style={{ background: "#F59E0B" }}>⏳ TASDEEQ BAQI</div>
                </div>
              </div>
              <ul className="mt-2 space-y-0.5 text-sm">
                {o.lines.map((l, i) => (
                  <li key={`${l.itemId}-${i}`} className="flex justify-between border-b border-dashed border-stone-200 pb-0.5"><span>{l.name}</span><b>× {l.qty} · Rs {Math.round(l.price * l.qty).toLocaleString()}</b></li>
                ))}
              </ul>
              <div className="mt-2 flex gap-3 items-start">
                {proof?.proofImage && (
                  <button onClick={() => setZoomProof(o)} className="shrink-0" title="Proof bara karke dekhein">
                    <img src={proof.proofImage} alt={`Payment proof — ${o.customerName ?? ""}`} className="w-20 h-20 object-cover rounded-xl border-2 border-amber-200" />
                    <span className="block text-[10px] font-bold text-stone-500 mt-0.5">🔍 Bara dekhein</span>
                  </button>
                )}
                <div className="text-sm flex-1 min-w-0">
                  <div>Method: <b>{proof?.method ?? "—"}</b>{proof?.txnId ? <> · Txn ID: <b>{proof.txnId}</b></> : ""}</div>
                  <div>Customer ne bheja: <b>Rs {(proof?.amount ?? 0).toLocaleString()}</b> · Order total: <b>Rs {o.total.toLocaleString()}</b></div>
                  <div className="font-black" style={{ color: amountOk ? "#16A34A" : "#DC2626" }}>
                    {amountOk ? "✅ Amount match hai" : "⚠️ AMOUNT MATCH NAHI — pehle check karein!"}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => confirm(o)} data-testid="verify-confirm" className="flex-1 rounded-xl py-3 font-black text-white active:scale-[0.99]" style={{ background: "#16A34A" }}>✅ Confirm — Order Aage Bhejein</button>
                <button onClick={() => reject(o)} data-testid="verify-reject" className="flex-1 rounded-xl py-3 font-black text-white active:scale-[0.99]" style={{ background: "#DC2626" }}>❌ Reject</button>
              </div>
            </div>
          );
        })}
      </div>
      {zoomProof?.paymentProof && (
        <div className="fixed inset-0 z-[90] bg-black/80 flex items-center justify-center p-4" onClick={() => setZoomProof(null)} role="dialog" aria-label="Payment proof — full size">
          <div className="max-w-lg w-full pop-in" onClick={(e) => e.stopPropagation()}>
            <img src={zoomProof.paymentProof.proofImage} alt="Payment proof — full size" className="w-full max-h-[78vh] object-contain rounded-2xl bg-white" />
            <div className="text-white text-center font-bold mt-2">
              {zoomProof.customerName} · {zoomProof.paymentProof.method} · Rs {zoomProof.paymentProof.amount.toLocaleString()} {zoomProof.paymentProof.txnId ? `· Txn ${zoomProof.paymentProof.txnId}` : ""}
            </div>
            <button onClick={() => setZoomProof(null)} className="mt-3 w-full rounded-2xl py-3 font-black text-white" style={{ background: "#DC2626" }}>✕ Band Karein</button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── 📈 Munafa Nuqsan (Profit & Loss) ────────────────────────────────────────
// Report SERVER par banta hai (server/services/pnl.ts) — wahi rules jo
// Phase 1 mein thay: sale set = payment-cleared orders; bill discount
// proportional; grocery lagat = packing wholesale; canteen lagat = item
// cost; deal lagat = components snapshot × menu cost; lagat na ho to woh
// bikri "Lagat Baqi" mein alag — KABHI munafa mein nahi (cost 0 nahi
// mana jata). Kharchay (expenses) yahin darj hote hain.
interface PnlShop { bikri: number; lagatBaqi: number; lagat: number; gross: number; kharchay: number; wastage: number; net: number }
interface PnlItem { name: string; shop: string; qty: number; bikri: number; lagat: number | null; munafa: number | null }
interface PnlReport {
  from: string; to: string;
  canteen: PnlShop; grocery: PnlShop; combined: PnlShop;
  items: PnlItem[]; unknownItems: { name: string; shop: string; bikri: number }[];
  udhaarDiya: number; wasooliPeriod: number; baqayaAllTime: number;
}
type PnlPreset = "today" | "week" | "month" | "prevMonth" | "custom";
function pnlRange(preset: PnlPreset, custom: { from: string; to: string }): { from: string; to: string } {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const now = new Date();
  if (preset === "today") return { from: iso(now), to: iso(now) };
  if (preset === "week") { const s = new Date(now); s.setDate(now.getDate() - 6); return { from: iso(s), to: iso(now) }; }
  if (preset === "month") return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  if (preset === "prevMonth") return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) };
  return { from: custom.from || iso(now), to: custom.to || iso(now) };
}
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString()}`;

function ProfitLossSection({ shop }: { shop: ShopSettings }) {
  const [preset, setPreset] = useState<PnlPreset>("month");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [report, setReport] = useState<PnlReport | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [expenses, setExpensesState] = useState<Expense[]>([]);
  const [expForm, setExpForm] = useState({ dateISO: "", title: "", amount: "", shop: "both" as Expense["shop"], note: "" });
  const [expEditId, setExpEditId] = useState<string | null>(null);
  const [expMsg, setExpMsg] = useState("");
  const range = pnlRange(preset, custom);
  const retailOn = hasRetail(shop);

  useEffect(() => {
    let live = true;
    apiGet<{ report: PnlReport }>(`/owner/pnl?from=${range.from}&to=${range.to}`)
      .then((r) => { if (live) { setReport(r.report); setLoadErr(""); } })
      .catch(() => { if (live) setLoadErr("Report load nahi hui — dobara try karein."); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, expenses]);

  useEffect(() => {
    const read = () => setExpensesState(loadExpenses());
    read();
    window.addEventListener("expenses-changed", read);
    const t = setInterval(read, 3000);
    return () => { window.removeEventListener("expenses-changed", read); clearInterval(t); };
  }, []);

  const periodExpenses = expenses.filter((e) => e.dateISO >= range.from && e.dateISO <= range.to);

  function saveExpense() {
    const amount = parseInt(expForm.amount, 10);
    if (!expForm.title.trim()) { setExpMsg("⚠️ Kharchay ka title likhein"); return; }
    if (isNaN(amount) || amount <= 0) { setExpMsg("⚠️ Amount (Rs) sahi likhein"); return; }
    if (!expForm.dateISO) { setExpMsg("⚠️ Tareekh chunein"); return; }
    const rec: Expense = {
      id: expEditId ?? `exp-${Date.now()}`,
      dateISO: expForm.dateISO, title: expForm.title.trim(), amount,
      shop: expForm.shop, note: expForm.note.trim() || undefined,
    };
    const next = expEditId ? expenses.map((e) => (e.id === expEditId ? rec : e)) : [rec, ...expenses];
    setExpensesState(next); saveExpenses(next);
    setExpForm({ dateISO: "", title: "", amount: "", shop: retailOn && !shop.hasCanteen ? "grocery" : "both", note: "" });
    setExpEditId(null);
    setExpMsg("✓ Kharcha darj ho gaya");
  }
  function editExpense(e: Expense) {
    setExpEditId(e.id);
    setExpForm({ dateISO: e.dateISO, title: e.title, amount: String(e.amount), shop: e.shop, note: e.note ?? "" });
    setExpMsg("");
  }
  function delExpense(e: Expense) {
    if (!window.confirm(`Kharcha "${e.title}" (${rs(e.amount)}) delete kar dein?`)) return;
    const next = expenses.filter((x) => x.id !== e.id);
    setExpensesState(next); saveExpenses(next);
    if (expEditId === e.id) setExpEditId(null);
  }

  const rows: { key: keyof PnlShop; label: string; bold?: boolean; color?: string }[] = [
    { key: "bikri", label: "Kul Bikri (Sales)" },
    { key: "lagatBaqi", label: "Lagat Baqi Bikri (cost nahi bhari — munafa mein nahi)", color: "#D97706" },
    { key: "lagat", label: "Lagat (COGS)" },
    { key: "gross", label: "Gross Munafa", bold: true },
    { key: "kharchay", label: "Kharchay (Expenses)" },
    { key: "wastage", label: "Wastage Nuqsan" },
    { key: "net", label: "Khaals Munafa (Net)", bold: true },
  ];
  const cols: { key: "canteen" | "grocery" | "combined"; label: string; show: boolean }[] = [
    { key: "canteen", label: "🍔 Canteen", show: shop.hasCanteen },
    { key: "grocery", label: "🛒 Dukaan", show: retailOn },
    { key: "combined", label: "🏪 Dono Mila Kar", show: true },
  ];

  return (
    <div className="space-y-4" data-testid="pnl-section">
      <section className="bg-white rounded-2xl border border-orange-100 shadow-sm p-4">
        <h2 className="font-extrabold mb-1">📈 Munafa Nuqsan — Profit &amp; Loss</h2>
        <p className="text-sm text-stone-500 mb-3">
          Bikri sirf <b>payment-clear orders</b> se ginti hai (proof pending/rejected shamil nahi; Udhaar bikri shamil hai).
          Grocery ki lagat = wholesale price; canteen ki lagat = item ki Lagat (Menu form mein bharein).
          Jis item ki lagat na bhari ho, us ki bikri <b>Lagat Baqi</b> mein alag dikhti hai — munafa mein nahi ginti.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {([["today", "Aaj"], ["week", "Is Hafta"], ["month", "Is Mahina"], ["prevMonth", "Pichla Mahina"], ["custom", "Custom"]] as [PnlPreset, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setPreset(k)} data-testid={`pnl-period-${k}`}
              className="rounded-full px-4 py-2 font-extrabold border-2"
              style={preset === k ? { background: "#0F172A", borderColor: "#0F172A", color: "#fff" } : { borderColor: "#E7E5E4", background: "#fff" }}>{label}</button>
          ))}
          {preset === "custom" && (
            <span className="flex items-center gap-2">
              <input type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="rounded-xl border-2 border-stone-200 px-3 py-2 font-bold" />
              <span className="font-bold text-stone-400">→</span>
              <input type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="rounded-xl border-2 border-stone-200 px-3 py-2 font-bold" />
            </span>
          )}
        </div>
        {loadErr && <p className="font-bold text-sm" style={{ color: "#DC2626" }}>{loadErr}</p>}
        {report && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[520px]">
                <thead>
                  <tr className="text-left text-stone-400 border-b-2 border-stone-100">
                    <th className="py-2 pr-2"></th>
                    {cols.filter((c) => c.show).map((c) => <th key={c.key} className="py-2 px-2 text-right">{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className="border-b border-stone-50">
                      <td className={`py-2 pr-2 ${r.bold ? "font-black" : "font-bold text-stone-600"}`}>{r.label}</td>
                      {cols.filter((c) => c.show).map((c) => {
                        const v = report[c.key][r.key];
                        return (
                          <td key={c.key} data-testid={`pnl-${r.key}-${c.key}`} className={`py-2 px-2 text-right ${r.bold ? "font-black" : "font-bold"}`}
                            style={{ color: r.key === "net" ? (v < 0 ? "#DC2626" : "#16A34A") : r.color }}>
                            {r.key === "lagat" || r.key === "kharchay" || r.key === "wastage" ? `− ${rs(v)}` : rs(v)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm font-bold text-stone-500 mt-3">
              💰 Udhaar: is period mein diya <b data-testid="pnl-udhaar-diya">{rs(report.udhaarDiya)}</b> · wasooli <b data-testid="pnl-udhaar-wasooli">{rs(report.wasooliPeriod)}</b> · kul baqaya (all-time) <b data-testid="pnl-udhaar-baqaya">{rs(report.baqayaAllTime)}</b>
            </p>
            {report.unknownItems.length > 0 && (
              <div className="mt-3 rounded-xl border-2 border-amber-200 bg-amber-50 px-3 py-2" data-testid="pnl-lagat-baqi-box">
                <div className="font-black text-sm" style={{ color: "#92400E" }}>⚠️ In items ki lagat nahi bhari — in ki bikri munafa mein NAHI ginti:</div>
                <ul className="text-sm font-bold text-stone-600 mt-1 space-y-0.5">
                  {report.unknownItems.map((u, i) => (
                    <li key={i} data-testid="pnl-unknown-row">{u.name} — bikri {rs(u.bikri)} <span className="text-stone-400">({u.shop === "grocery" ? "dukaan" : "canteen"})</span></li>
                  ))}
                </ul>
                <p className="text-xs font-bold text-stone-500 mt-1">Canteen item ki lagat: Owner → Canteen Menu → item Edit → &quot;LAGAT / COST RS&quot;. Grocery ki lagat = us ka wholesale price (product form).</p>
              </div>
            )}
          </>
        )}
      </section>

      {report && report.items.length > 0 && (
        <section className="bg-white rounded-2xl border border-orange-100 shadow-sm p-4" data-testid="pnl-items">
          <h2 className="font-extrabold mb-2">🏆 Item-wise Munafa — {range.from} → {range.to}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-stone-400 border-b-2 border-stone-100">
                  <th className="py-2 pr-2">Item</th><th className="py-2 px-2">Dukaan</th>
                  <th className="py-2 px-2 text-right">Qty</th><th className="py-2 px-2 text-right">Bikri</th>
                  <th className="py-2 px-2 text-right">Lagat</th><th className="py-2 pl-2 text-right">Munafa</th>
                </tr>
              </thead>
              <tbody>
                {report.items.map((it, i) => (
                  <tr key={i} data-testid="pnl-item-row" className="border-b border-stone-50">
                    <td className="py-1.5 pr-2 font-bold leading-snug">{it.name}</td>
                    <td className="py-1.5 px-2 text-stone-500">{it.shop === "grocery" ? "🛒 Dukaan" : "🍔 Canteen"}</td>
                    <td className="py-1.5 px-2 text-right font-bold">{it.qty}</td>
                    <td className="py-1.5 px-2 text-right font-bold">{rs(it.bikri)}</td>
                    <td className="py-1.5 px-2 text-right font-bold">{it.lagat === null ? <span style={{ color: "#D97706" }}>⚠️ nahi bhari</span> : rs(it.lagat)}</td>
                    <td className="py-1.5 pl-2 text-right font-black" style={{ color: it.munafa === null ? "#D97706" : it.munafa < 0 ? "#DC2626" : "#16A34A" }}>{it.munafa === null ? "—" : rs(it.munafa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Kharchay register ── */}
      <section className="bg-white rounded-2xl border border-orange-100 shadow-sm p-4">
        <h2 className="font-extrabold mb-1">🧾 Kharchay — Expenses Register</h2>
        <p className="text-sm text-stone-500 mb-3">Bijli, gas, tankhwah, kiraya waghera yahan darj karein — P&amp;L ki &quot;Kharchay&quot; line inhi se banti hai. &quot;Dono&quot; wala kharcha sirf combined column mein ginta hai.</p>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-2 mb-2">
          <label className="block">
            <span className="block text-[11px] font-extrabold uppercase tracking-wide text-stone-500 mb-1">Tareekh</span>
            <input type="date" value={expForm.dateISO} onChange={(e) => setExpForm((f) => ({ ...f, dateISO: e.target.value }))} data-testid="expense-date"
              className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 font-bold outline-none focus:border-orange-500 bg-[#F6F9FF]" />
          </label>
          <label className="block col-span-2">
            <span className="block text-[11px] font-extrabold uppercase tracking-wide text-stone-500 mb-1">Title — kis cheez ka kharcha</span>
            <input value={expForm.title} onChange={(e) => setExpForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Bijli ka bill" data-testid="expense-title"
              className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 font-bold outline-none focus:border-orange-500 bg-[#F6F9FF]" />
          </label>
          <label className="block">
            <span className="block text-[11px] font-extrabold uppercase tracking-wide text-stone-500 mb-1">Amount Rs</span>
            <input value={expForm.amount} onChange={(e) => setExpForm((f) => ({ ...f, amount: e.target.value.replace(/[^0-9]/g, "") }))} inputMode="numeric" placeholder="0" data-testid="expense-amount"
              className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 font-bold outline-none focus:border-orange-500 bg-[#F6F9FF]" />
          </label>
          <label className="block">
            <span className="block text-[11px] font-extrabold uppercase tracking-wide text-stone-500 mb-1">Dukaan</span>
            <select value={expForm.shop} onChange={(e) => setExpForm((f) => ({ ...f, shop: e.target.value as Expense["shop"] }))} data-testid="expense-shop"
              className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 font-bold outline-none focus:border-orange-500 bg-[#F6F9FF]">
              {shop.hasCanteen && <option value="canteen">🍔 Canteen</option>}
              {retailOn && <option value="grocery">🛒 Dukaan</option>}
              <option value="both">🏪 Dono (shared)</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] font-extrabold uppercase tracking-wide text-stone-500 mb-1">Note (optional)</span>
            <input value={expForm.note} onChange={(e) => setExpForm((f) => ({ ...f, note: e.target.value }))} placeholder="—" data-testid="expense-note"
              className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 font-bold outline-none focus:border-orange-500 bg-[#F6F9FF]" />
          </label>
        </div>
        <div className="flex items-center gap-2 mb-3">
          <button onClick={saveExpense} data-testid="expense-save" className="rounded-xl px-5 py-2.5 font-black text-white" style={{ background: "#16A34A" }}>{expEditId ? "✓ Update Karein" : "➕ Kharcha Darj Karein"}</button>
          {expEditId && <button onClick={() => { setExpEditId(null); setExpForm({ dateISO: "", title: "", amount: "", shop: "both", note: "" }); }} className="rounded-xl px-4 py-2.5 font-bold bg-stone-100">Cancel</button>}
          {expMsg && <span className="font-bold text-sm" style={{ color: expMsg.startsWith("✓") ? "#16A34A" : "#DC2626" }}>{expMsg}</span>}
        </div>
        {periodExpenses.length === 0 ? (
          <p className="text-sm font-bold text-stone-400">Is period mein koi kharcha darj nahi.</p>
        ) : (
          <ul className="space-y-1.5">
            {periodExpenses.map((e) => (
              <li key={e.id} data-testid="expense-row" className="flex flex-wrap items-center gap-2 rounded-xl bg-orange-50/60 border border-orange-100 px-3 py-2">
                <span className="font-bold text-sm">{e.dateISO}</span>
                <span className="font-extrabold leading-snug">{e.title}</span>
                <span className="text-[10px] font-black rounded-full px-2 py-0.5 text-white" style={{ background: e.shop === "canteen" ? "#E64A19" : e.shop === "grocery" ? "#388E3C" : "#0F172A" }}>{e.shop === "canteen" ? "🍔 CANTEEN" : e.shop === "grocery" ? "🛒 DUKAAN" : "🏪 DONO"}</span>
                {e.note && <span className="text-xs font-bold text-stone-400">{e.note}</span>}
                <span className="ml-auto font-black">{rs(e.amount)}</span>
                <button onClick={() => editExpense(e)} data-testid="expense-edit" className="font-bold text-sm px-3 py-1.5 rounded-lg bg-white border border-stone-200">Edit</button>
                <button onClick={() => delExpense(e)} data-testid="expense-del" className="font-bold text-sm px-3 py-1.5 rounded-lg bg-white border border-red-200" style={{ color: "#DC2626" }}>Delete</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function OwnerScreen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [form, setForm] = useState({ name: "", price: "", cost: "", category: "Snacks" as Category, emoji: "🍽️" });
  const [editId, setEditId] = useState<string | null>(null);
  const [viewOrder, setViewOrder] = useState<Order | null>(null);
  const [origin, setOrigin] = useState("http://localhost:3007");
  useEffect(() => { try { setOrigin(window.location.origin); } catch {} }, []);
  const shop = useShop();
  const [shopForm, setShopForm] = useState<ShopSettings>(SHOP_DEFAULTS);
  const [shopInit, setShopInit] = useState(false);
  const [shopSaved, setShopSaved] = useState(false);
  useEffect(() => {
    if (!shopInit) { setShopForm(loadShop()); setShopInit(true); }
  }, [shopInit]);
  // Table count control (Tables & QR tab) — draft mirrors the saved count.
  const [tcDraft, setTcDraft] = useState("8");
  const [tcSaved, setTcSaved] = useState(false);
  useEffect(() => { setTcDraft(String(shop.tableCount ?? 8)); }, [shop.tableCount]);
  function applyTableCount(raw: number) {
    const n = Math.min(100, Math.max(1, Math.round(raw) || 8));
    setTcDraft(String(n));
    saveShop({ ...loadShop(), tableCount: n });
    setShopForm((f) => ({ ...f, tableCount: n }));
    setTcSaved(true); setTimeout(() => setTcSaved(false), 2500);
  }
  const [grocery, setGrocery] = useState<GroceryItem[]>([]);
  const [gForm, setGForm] = useState({ name: "", brand: "", sku: "", barcode: "", retail: "", wholesale: "", wsMin: "", stock: "", unit: "piece" as "piece" | "kg", emoji: "🛒", headId: "", subId: "", image: "", boardOffer: false, offerPrice: "", trackSerial: false });
  const [gPackings, setGPackings] = useState<{ label: string; retail: string; wholesale: string; barcode: string; containsQty: string; wsMin: string }[]>([]);
  // Phase 2 variant editor state (variants live server-side per master).
  const [variantDraft, setVariantDraft] = useState("");
  const [variantMsg, setVariantMsg] = useState("");
  const [vpForm, setVpForm] = useState({ variant: "Standard", label: "", retail: "", wholesale: "", barcode: "" });
  async function refreshCatalogState() {
    try {
      const r = await apiGet<{ items: GroceryItem[] }>("/catalog");
      setGrocery(r.items);
    } catch { /* facade refresh will land shortly anyway */ }
  }
  async function addVariant() {
    if (!gEditId || !variantDraft.trim()) { setVariantMsg("⚠️ Variant ka naam likhein"); return; }
    try {
      await apiPost(`/owner/grocery/products/${gEditId}/variants`, { name: variantDraft.trim() });
      setVariantMsg(`✓ Variant "${variantDraft.trim()}" add ho gaya`);
      setVariantDraft("");
      await refreshCatalogState();
    } catch { setVariantMsg("❌ Variant add nahi hua — dobara try karein"); }
  }
  async function addVariantPacking() {
    if (!gEditId || !vpForm.label.trim() || !(parseInt(vpForm.retail, 10) > 0)) { setVariantMsg("⚠️ Packing label aur retail price lazmi hain"); return; }
    try {
      await apiPost(`/owner/grocery/products/${gEditId}/variants/${encodeURIComponent(vpForm.variant)}/packings`, {
        label: vpForm.label.trim(),
        retailPrice: parseInt(vpForm.retail, 10),
        wholesalePrice: parseInt(vpForm.wholesale, 10) || parseInt(vpForm.retail, 10),
        barcode: vpForm.barcode.trim() || undefined,
      });
      setVariantMsg(`✓ Packing "${vpForm.label.trim()}" ${vpForm.variant} variant mein add ho gayi`);
      setVpForm({ ...vpForm, label: "", retail: "", wholesale: "", barcode: "" });
      await refreshCatalogState();
    } catch { setVariantMsg("❌ Packing add nahi hui — variant pehle add karein"); }
  }
  const [gEditId, setGEditId] = useState<string | null>(null);
  // Grocery heads manager state (3-level: heads + sub-heads; add / rename / delete-empty)
  const [heads, setHeads] = useState<GroceryHead[]>([]);
  const [subs, setSubs] = useState<GrocerySubHead[]>([]);
  const [headName, setHeadName] = useState("");
  const [headImage, setHeadImage] = useState("");
  const [headEditImg, setHeadEditImg] = useState("");
  const [headEmoji, setHeadEmoji] = useState("🏠");
  const [headMsg, setHeadMsg] = useState("");
  const [headEditId, setHeadEditId] = useState<string | null>(null);
  const [headEditName, setHeadEditName] = useState("");
  const [subName, setSubName] = useState("");
  const [subImage, setSubImage] = useState("");
  const [subEditImg, setSubEditImg] = useState("");
  const [subHeadSel, setSubHeadSel] = useState("");
  const [subEditId, setSubEditId] = useState<string | null>(null);
  const [subEditName, setSubEditName] = useState("");
  // Barcode label printing state — selection (id → sticker copies), filters,
  // and the open print sheet (product + copies entries).
  const [labelSel, setLabelSel] = useState<Record<string, number>>({});
  const [labelHead, setLabelHead] = useState("all");
  const [labelSub, setLabelSub] = useState("all");
  const [labelSearch, setLabelSearch] = useState("");
  const [sheet, setSheet] = useState<{ item: GroceryItem; copies: number }[] | null>(null);
  // Grocery products LIST controls — compact table + filters + pagination
  // (622 products as cards made the dashboard enormous; one row per product,
  // 50 per page, never render the whole catalogue at once).
  const [prodSearch, setProdSearch] = useState("");
  const [prodHead, setProdHead] = useState("all");
  const [prodSub, setProdSub] = useState("all");
  const [prodPage, setProdPage] = useState(1);
  // Owner Dashboard section tabs — one section at a time instead of one
  // endless stacked scroll. Print overlays (label sheet / receipt view)
  // stay OUTSIDE this switch so print flows never break.
  const [ownerTab, setOwnerTab] = useState<"overview" | "menu" | "grocery" | "udhaar" | "pnl" | "heads" | "labels" | "staff" | "settings" | "tables">("overview");
  // Heads manager — sub-heads collapsed by default; a head expands on ▶.
  const [expandedHeads, setExpandedHeads] = useState<Record<string, boolean>>({});
  const [subDrafts, setSubDrafts] = useState<Record<string, string>>({});

  // Orders refresh — the payment verification panel must never sit stale.
  useEffect(() => {
    const read = () => setOrders(loadOrders());
    const t = setInterval(read, 2500);
    window.addEventListener("storage", read);
    window.addEventListener("canteen-orders-changed", read);
    return () => { clearInterval(t); window.removeEventListener("storage", read); window.removeEventListener("canteen-orders-changed", read); };
  }, []);

  useEffect(() => {
    setOrders(loadOrders()); setMenu(loadMenu()); setGrocery(loadGrocery());
    const hs = loadGroceryHeads(); const ss = loadGrocerySubHeads();
    setHeads(hs); setSubs(ss);
    // Product form starts on the first head + its first sub-head.
    const firstSub = ss.find((s) => s.headId === hs[0]?.id);
    setGForm((f) => ({ ...f, headId: f.headId || (hs[0]?.id ?? ""), subId: f.subId || (firstSub?.id ?? "") }));
    setSubHeadSel(hs[0]?.id ?? "");
  }, []);

  const todays = useMemo(() => orders.filter(isToday), [orders]);
  const totalSales = todays.reduce((s, o) => s + o.total, 0);
  const canteenSales = todays.filter((o) => o.mode !== "grocery").reduce((s, o) => s + o.total, 0);
  const grocerySales = todays.filter((o) => o.mode === "grocery").reduce((s, o) => s + o.total, 0);
  const cash = todays.filter((o) => o.payment === "Cash").reduce((s, o) => s + o.total, 0);
  const online = todays.filter((o) => o.payment === "JazzCash" || o.payment === "Easypaisa" || o.payment === "Online").reduce((s, o) => s + o.total, 0);
  const onlineOrders = todays.filter((o) => o.source === "online");
  const onlineOrderSales = onlineOrders.reduce((s, o) => s + o.total, 0);
  const onlineCanteenSales = onlineOrders.filter((o) => o.mode !== "grocery").reduce((s, o) => s + o.total, 0);
  const onlineGrocerySales = onlineOrders.filter((o) => o.mode === "grocery").reduce((s, o) => s + o.total, 0);
  const counterSales = totalSales - onlineOrderSales;
  const udhaar = todays.filter((o) => o.payment === "Udhaar").reduce((s, o) => s + o.total, 0);
  // Low-stock count sirf ON dukaanon ka (business setup gating).
  const retailOn = hasRetail(shop);
  const lowStockCount =
    (shop.hasCanteen ? menu.filter((m) => (m.stock ?? 0) <= (m.lowStock ?? 5)).length : 0) +
    (retailOn ? grocery.filter((g) => g.stock <= (g.lowStock ?? (g.unit === "kg" ? 2 : 5))).length : 0);
  // ⏰ Expiry Qareeb (Owner Overview) — sirf Medical Store setup mein;
  // Stock screen wali hi list (recorded stock-IN expiries se).
  const expirySoon = shop.retailType === "medical" ? expiringProducts(grocery, loadStockEntries()) : [];

  const best = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; amount: number }>();
    todays.forEach((o) => o.lines.forEach((l) => {
      const cur = map.get(l.itemId) || { name: l.name, qty: 0, amount: 0 };
      cur.qty += l.qty; cur.amount += l.price * l.qty; map.set(l.itemId, cur);
    }));
    return [...map.values()].sort((a, b) => b.qty - a.qty);
  }, [todays]);

  function saveItem() {
    const price = parseInt(form.price, 10);
    if (!form.name.trim() || isNaN(price) || price <= 0) return;
    // Lagat (cost) — optional; khali = undefined (us item ki bikri P&L
    // mein "lagat baqi" ginti hai, munafa mein NAHI — kabhi 0 nahi).
    const costNum = parseInt(form.cost, 10);
    const cost = !isNaN(costNum) && costNum > 0 ? costNum : undefined;
    let next: MenuItem[];
    if (editId) {
      next = menu.map((m) => (m.id === editId ? { ...m, name: form.name.trim(), price, cost, category: form.category, emoji: form.emoji || "🍽️" } : m));
    } else {
      next = [...menu, { id: `item-${Date.now()}`, name: form.name.trim(), price, cost, category: form.category, emoji: form.emoji || "🍽️" }];
    }
    setMenu(next); saveMenu(next);
    setForm({ name: "", price: "", cost: "", category: "Snacks", emoji: "🍽️" }); setEditId(null);
  }
  function del(id: string) { const next = menu.filter((m) => m.id !== id); setMenu(next); saveMenu(next); }
  function edit(m: MenuItem) { setEditId(m.id); setForm({ name: m.name, price: String(m.price), cost: m.cost ? String(m.cost) : "", category: m.category, emoji: m.emoji }); }

  // ── 🎁 Deals (combo offers) ──────────────────────────────────────────
  const [deals, setDeals] = useState<Deal[]>([]);
  const [dealForm, setDealForm] = useState({ name: "", price: "" });
  const [dealPicks, setDealPicks] = useState<Record<string, number>>({});
  const [dealEditId, setDealEditId] = useState<string | null>(null);
  const [dealMsg, setDealMsg] = useState("");
  useEffect(() => {
    const read = () => setDeals(loadDeals());
    read();
    window.addEventListener("pos-catalog-changed", read);
    return () => window.removeEventListener("pos-catalog-changed", read);
  }, []);
  const dealPickedItems = Object.entries(dealPicks).filter(([, q]) => q > 0).map(([menuItemId, qty]) => ({ menuItemId, qty }));
  const dealFormValue = dealPickedItems.reduce((s, i) => s + (menu.find((m) => m.id === i.menuItemId)?.price ?? 0) * i.qty, 0);
  function saveDeal() {
    const price = parseInt(dealForm.price, 10);
    if (!dealForm.name.trim()) { setDealMsg("⚠️ Deal ka naam likhein (e.g. Student Deal)"); return; }
    if (dealPickedItems.length === 0) { setDealMsg("⚠️ Deal mein kam az kam ek cheez add karein"); return; }
    if (isNaN(price) || price <= 0) { setDealMsg("⚠️ Deal ki price (Rs) likhein — 0 se zyada"); return; }
    let next: Deal[];
    if (dealEditId) {
      next = deals.map((d) => (d.id === dealEditId ? { ...d, name: dealForm.name.trim(), price, items: dealPickedItems } : d));
      setDealMsg(`✓ Deal "${dealForm.name.trim()}" update ho gayi`);
    } else {
      next = [...deals, { id: `deal-${Date.now()}`, name: dealForm.name.trim(), price, items: dealPickedItems, active: true }];
      setDealMsg(`✓ Deal "${dealForm.name.trim()}" ban gayi — Canteen POS, Online Order aur Menu Board par live hai`);
    }
    setDeals(next); saveDeals(next);
    setDealForm({ name: "", price: "" }); setDealPicks({}); setDealEditId(null);
  }
  function editDeal(d: Deal) {
    setDealEditId(d.id);
    setDealForm({ name: d.name, price: String(d.price) });
    setDealPicks(Object.fromEntries(d.items.map((i) => [i.menuItemId, i.qty])));
    setDealMsg("");
  }
  function delDeal(d: Deal) {
    if (!window.confirm(`Deal "${d.name}" delete kar dein? Purane orders par is ka asar nahi parega.`)) return;
    const next = deals.filter((x) => x.id !== d.id);
    setDeals(next); saveDeals(next);
    if (dealEditId === d.id) { setDealEditId(null); setDealForm({ name: "", price: "" }); setDealPicks({}); }
  }
  function toggleDeal(d: Deal) {
    const next = deals.map((x) => (x.id === d.id ? { ...x, active: !x.active } : x));
    setDeals(next); saveDeals(next);
  }

  const subsOfHead = (hid: string) => subs.filter((s) => s.headId === hid);
  function saveGItem() {
    const retail = parseInt(gForm.retail, 10); const wholesale = parseInt(gForm.wholesale, 10) || retail;
    const stock = parseFloat(gForm.stock);
    if (!gForm.name.trim() || !gForm.sku.trim() || isNaN(retail) || retail <= 0 || isNaN(stock)) return;
    let next: GroceryItem[];
    // Head + Sub-Head: the form's choice — fall back to the first head / its
    // first sub-head if the chosen ones were deleted while the form was open
    // (never save a product outside the 3-level structure). A head with NO
    // sub-heads cannot take products yet — add a sub-head first (manager).
    const headId = heads.some((h) => h.id === gForm.headId) ? gForm.headId : (heads[0]?.id ?? "");
    const subId = subsOfHead(headId).some((s) => s.id === gForm.subId) ? gForm.subId : (subsOfHead(headId)[0]?.id ?? "");
    if (!headId || !subId) { setHeadMsg("⚠️ Product save nahi hua — pehle is head ke andar ek Sub-Head add karein (neeche Heads manager mein)."); return; }
    // Packings: only complete rows (label + retail price) are kept. Each
    // packing may carry its OWN barcode, a containsQty (sealed packs inside
    // — smallest sealed pack = 1, Full Dabba = N) and its own wholesale min.
    const packings = gPackings
      .filter((p) => p.label.trim() && parseInt(p.retail, 10) > 0)
      .map((p) => ({
        label: p.label.trim(), retailPrice: parseInt(p.retail, 10), wholesalePrice: parseInt(p.wholesale, 10) || parseInt(p.retail, 10),
        barcode: p.barcode.trim() || undefined,
        containsQty: parseFloat(p.containsQty) > 0 ? parseFloat(p.containsQty) : undefined,
        wholesaleMinQty: parseFloat(p.wsMin) > 0 ? parseFloat(p.wsMin) : undefined,
      }));
    const wsMin = parseFloat(gForm.wsMin);
    // Offer Price: khali/0 = no offer price stored. A value >= retail is
    // stored but stays INACTIVE by the offerActive rule (board + till keep
    // charging retail) — the form hint says exactly that.
    const offerPrice = parseInt(gForm.offerPrice, 10) || undefined;
    const base = { name: gForm.name.trim(), brand: gForm.brand.trim() || null, sku: gForm.sku.trim(), barcode: gForm.barcode.trim() || undefined, retailPrice: retail, wholesalePrice: wholesale, wholesaleMinQty: wsMin > 0 ? wsMin : null, stock, unit: gForm.unit, emoji: gForm.emoji || "🛒", headId, subId, image: gForm.image.trim() || undefined, boardOffer: gForm.boardOffer || undefined, offerPrice, trackSerial: gForm.trackSerial || undefined, packings: packings.length ? packings : undefined };
    if (gEditId) next = grocery.map((g) => (g.id === gEditId ? { ...g, ...base } : g));
    else next = [...grocery, { id: `g-${Date.now()}`, ...base }];
    setGrocery(next); saveGrocery(next);
    setGForm({ name: "", brand: "", sku: "", barcode: "", retail: "", wholesale: "", wsMin: "", stock: "", unit: "piece", emoji: "🛒", headId, subId, image: "", boardOffer: false, offerPrice: "", trackSerial: false }); setGPackings([]); setGEditId(null);
  }
  function delG(id: string) { const next = grocery.filter((g) => g.id !== id); setGrocery(next); saveGrocery(next); }
  // Menu Board Offers quick-toggle — same flag the product form's checkbox
  // edits; the board picks it up on its next loop (it polls the same store).
  function toggleBoardOffer(g: GroceryItem) {
    const next = grocery.map((x) => (x.id === g.id ? { ...x, boardOffer: !x.boardOffer } : x));
    setGrocery(next); saveGrocery(next);
  }
  function editG(g: GroceryItem) {
    setGEditId(g.id);
    setGForm({ name: g.name, brand: g.brand ?? "", sku: g.sku, barcode: g.barcode ?? "", retail: String(g.retailPrice), wholesale: String(g.wholesalePrice), wsMin: g.wholesaleMinQty ? String(g.wholesaleMinQty) : "", stock: String(g.stock), unit: g.unit, emoji: g.emoji, headId: g.headId, subId: g.subId, image: g.image ?? "", boardOffer: g.boardOffer ?? false, offerPrice: g.offerPrice !== undefined ? String(g.offerPrice) : "", trackSerial: g.trackSerial ?? false });
    setGPackings((g.packings ?? []).map((p) => ({ label: p.label, retail: String(p.retailPrice), wholesale: String(p.wholesalePrice), barcode: p.barcode ?? "", containsQty: p.containsQty ? String(p.containsQty) : "", wsMin: p.wholesaleMinQty ? String(p.wholesaleMinQty) : "" })));
  }
  function resetGForm() {
    setGEditId(null); setGPackings([]);
    setGForm({ name: "", brand: "", sku: "", barcode: "", retail: "", wholesale: "", wsMin: "", stock: "", unit: "piece", emoji: "🛒", headId: heads[0]?.id ?? "", subId: subs.find((s) => s.headId === heads[0]?.id)?.id ?? "", image: "", boardOffer: false, offerPrice: "", trackSerial: false });
  }

  // ── Grocery heads manager (Main Head → Sub Head) ──
  const headCount = (id: string) => grocery.filter((g) => g.headId === id).length;
  const subCount = (id: string) => grocery.filter((g) => g.subId === id).length;
  function addHead() {
    const name = headName.trim();
    if (!name) { setHeadMsg("⚠️ Head ka naam likhein"); return; }
    const base = slugify(name);
    const id = heads.some((h) => h.id === base) ? `${base}-${Date.now()}` : base;
    const nh: GroceryHead = { id, name, emoji: headEmoji, tint: HEAD_TINTS[heads.length % HEAD_TINTS.length] };
    if (headImage.trim()) nh.image = headImage.trim();
    const next = [...heads, nh];
    setHeads(next); saveGroceryHeads(next);
    setHeadName(""); setHeadImage("");
    if (!subHeadSel) setSubHeadSel(id);
    setHeadMsg(`✓ Head "${name}" add ho gaya — ab is ke andar Sub-Head add karein, phir products daalein`);
  }
  function renameHead() {
    const name = headEditName.trim();
    if (!headEditId || !name) return;
    const next = heads.map((h) => (h.id === headEditId ? { ...h, name, image: headEditImg.trim() || undefined } : h));
    setHeads(next); saveGroceryHeads(next);
    setHeadEditId(null);
    setHeadMsg(`✓ Head ka naam "${name}" ho gaya`);
  }
  function deleteHead(h: GroceryHead) {
    const n = headCount(h.id);
    if (n > 0) {
      setHeadMsg(`⛔ "${h.name}" mein abhi ${n} product${n === 1 ? "" : "s"} hain — pehle un products ko Edit karke doosre head mein shift karein, phir ye head delete hoga.`);
      return;
    }
    const childSubs = subsOfHead(h.id);
    if (!window.confirm(childSubs.length
      ? `Head "${h.name}" delete kar dein? Is ke ${childSubs.length} sub-head bhi delete ho jayenge (un mein koi product nahi hai).`
      : `Head "${h.name}" delete kar dein? (Is mein koi product nahi hai)`)) return;
    const nextHeads = heads.filter((x) => x.id !== h.id);
    const nextSubs = subs.filter((s) => s.headId !== h.id);
    setHeads(nextHeads); saveGroceryHeads(nextHeads);
    setSubs(nextSubs); saveGrocerySubHeads(nextSubs);
    if (headEditId === h.id) setHeadEditId(null);
    if (gForm.headId === h.id) setGForm((f) => ({ ...f, headId: nextHeads[0]?.id ?? "", subId: nextSubs.find((s) => s.headId === nextHeads[0]?.id)?.id ?? "" }));
    if (subHeadSel === h.id) setSubHeadSel(nextHeads[0]?.id ?? "");
    setHeadMsg(`✓ Head "${h.name}" delete ho gaya`);
  }
  function addSub(forHead?: string) {
    // No argument → the bottom form (subHeadSel + subName). With a head id →
    // that head's own inline add row in the expanded heads manager (its
    // subDrafts entry). Same validation, messages and store call either way.
    const name = (forHead ? (subDrafts[forHead] ?? "") : subName).trim();
    const hid = forHead ?? (heads.some((h) => h.id === subHeadSel) ? subHeadSel : (heads[0]?.id ?? ""));
    if (!name) { setHeadMsg("⚠️ Sub-head ka naam likhein"); return; }
    if (!hid) { setHeadMsg("⚠️ Pehle ek Head add karein — sub-head head ke andar banta hai"); return; }
    const base = `${hid}:${slugify(name)}`;
    const id = subs.some((s) => s.id === base) ? `${base}-${Date.now()}` : base;
    const ns: GrocerySubHead = { id, headId: hid, name };
    if (!forHead && subImage.trim()) ns.image = subImage.trim();
    const next = [...subs, ns];
    setSubs(next); saveGrocerySubHeads(next);
    if (forHead) setSubDrafts((d) => ({ ...d, [forHead]: "" })); else { setSubName(""); setSubImage(""); }
    setHeadMsg(`✓ Sub-head "${name}" add ho gaya (${heads.find((h) => h.id === hid)?.name} ke andar)`);
  }
  function renameSub() {
    const name = subEditName.trim();
    if (!subEditId || !name) return;
    const next = subs.map((s) => (s.id === subEditId ? { ...s, name, image: subEditImg.trim() || undefined } : s));
    setSubs(next); saveGrocerySubHeads(next);
    setSubEditId(null);
    setHeadMsg(`✓ Sub-head ka naam "${name}" ho gaya`);
  }
  function deleteSub(s: GrocerySubHead) {
    const n = subCount(s.id);
    if (n > 0) {
      setHeadMsg(`⛔ "${s.name}" mein abhi ${n} product${n === 1 ? "" : "s"} hain — pehle un products ko Edit karke doosre sub-head mein shift karein, phir ye sub-head delete hoga.`);
      return;
    }
    if (!window.confirm(`Sub-head "${s.name}" delete kar dein? (Is mein koi product nahi hai)`)) return;
    const next = subs.filter((x) => x.id !== s.id);
    setSubs(next); saveGrocerySubHeads(next);
    if (subEditId === s.id) setSubEditId(null);
    if (gForm.subId === s.id) setGForm((f) => ({ ...f, subId: next.find((x) => x.headId === f.headId)?.id ?? "" }));
    setHeadMsg(`✓ Sub-head "${s.name}" delete ho gaya`);
  }

  // ── Barcode labels ──
  const labelVisible = grocery.filter((g) => {
    const q = labelSearch.trim().toLowerCase();
    if (q) return g.name.toLowerCase().includes(q) || g.sku.includes(q);
    if (labelHead !== "all" && g.headId !== labelHead) return false;
    if (labelSub !== "all" && g.subId !== labelSub) return false;
    return true;
  });
  const labelEntries = grocery
    .filter((g) => labelSel[g.id] !== undefined)
    .map((g) => ({ item: g, copies: Math.max(1, labelSel[g.id] || 1) }));
  const labelTotal = labelEntries.reduce((s, e) => s + e.copies, 0);
  function toggleLabel(id: string, on: boolean) {
    setLabelSel((sel) => {
      const next = { ...sel };
      if (on) next[id] = next[id] ?? 1; else delete next[id];
      return next;
    });
  }

  // ── Grocery products table: filtered + paginated view of the catalogue ──
  const PROD_PAGE_SIZE = 50;
  const prodFiltered = grocery.filter((g) => {
    const q = prodSearch.trim().toLowerCase();
    if (q && !(g.name.toLowerCase().includes(q) || g.sku.toLowerCase().includes(q) || (g.barcode ?? "").toLowerCase().includes(q))) return false;
    if (prodHead !== "all" && g.headId !== prodHead) return false;
    if (prodSub !== "all" && g.subId !== prodSub) return false;
    return true;
  });
  const prodTotalPages = Math.max(1, Math.ceil(prodFiltered.length / PROD_PAGE_SIZE));
  const prodPageSafe = Math.min(prodPage, prodTotalPages);
  const prodPageItems = prodFiltered.slice((prodPageSafe - 1) * PROD_PAGE_SIZE, prodPageSafe * PROD_PAGE_SIZE);
  // Pending payment verifications — badge on the Overview tab (same filter
  // as the Payment Verification panel's own count).
  const pendingVerifyCount = orders.filter((o) => o.source === "online" && o.paymentStatus === "proof_pending").length;

  // Owner sections — BUSINESS SETUP gating: jo dukaan setup mein off hai
  // us ke sections yahan bhi nahi bante (menu/tables sirf canteen par;
  // grocery/heads/labels sirf retail par; overview/pnl/udhaar/staff/
  // settings hamesha).
  const ownerTabs: { id: typeof ownerTab; label: string }[] = [
    { id: "overview", label: "📊 Overview" },
    ...(shop.hasCanteen ? [{ id: "menu" as const, label: "🍽️ Canteen Menu" }] : []),
    ...(retailOn ? [{ id: "grocery" as const, label: "🛒 Grocery" }] : []),
    { id: "udhaar", label: "💰 Udhaar Khata" },
    { id: "pnl", label: "📈 Munafa Nuqsan" },
    ...(retailOn ? [{ id: "heads" as const, label: "🗂️ Heads" }, { id: "labels" as const, label: "🏷️ Labels" }] : []),
    { id: "staff", label: "🔐 Staff" },
    { id: "settings", label: "⚙️ Settings" },
    ...(shop.hasCanteen ? [{ id: "tables" as const, label: "🪑 Tables QR" }] : []),
  ];
  // Khula tab setup change se chhup jaye to Overview par wapas.
  useEffect(() => {
    if (!ownerTabs.some((t) => t.id === ownerTab)) setOwnerTab("overview");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop.hasCanteen, retailOn, ownerTab]);
  const businessSummary = shop.hasCanteen && retailOn
    ? `🏪 Dono — Canteen + ${templateOf(shop.retailType)?.label ?? "Dukaan"}`
    : shop.hasCanteen
      ? "🍔 Sirf Canteen"
      : `${templateOf(shop.retailType)?.emoji ?? "🛒"} Sirf ${templateOf(shop.retailType)?.label ?? "Dukaan"}`;

  const cards = [
    { label: "Today's Total Sales", num: totalSales, prefix: "Rs ", color: "#F97316", icon: "💰" },
    { label: "Orders Today", num: todays.length, prefix: "", color: "#0F172A", icon: "🧾" },
    { label: "Cash", num: cash, prefix: "Rs ", color: "#16A34A", icon: "💵" },
    { label: "Online (JazzCash + Easypaisa)", num: online, prefix: "Rs ", color: "#1976D2", icon: "📱" },
    { label: "Udhaar (Khata)", num: udhaar, prefix: "Rs ", color: "#F59E0B", icon: "📒" },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar />
      <OrderAlerts role="owner" />
      <main className="p-4 space-y-6 max-w-6xl mx-auto w-full">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-orange-100 bg-white p-3 shadow-sm">
          <div>
            <div className="font-extrabold">📖 Owner Guidelines — Tabs Wise</div>
            <p className="text-sm font-semibold text-stone-500">Har tab ki apni guideline usi tab mein hai; saari ek jaga dekhni hon to index kholein.</p>
          </div>
          <GuidelineIndexButton />
        </div>
        {/* Owner section tabs — sticky sub-navigation; sirf selected
            section render hota hai, poora dashboard ek lambi scroll nahi.
            Default: Overview. */}
        <div className="sticky top-0 z-30 rounded-2xl border border-orange-100 bg-white shadow-sm p-1.5 flex flex-wrap gap-1" data-testid="owner-tabs" role="tablist" aria-label="Owner Dashboard sections">
          {ownerTabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={ownerTab === t.id} data-testid={`owner-tab-${t.id}`} onClick={() => setOwnerTab(t.id)}
              className="rounded-xl px-3 py-2 text-sm font-extrabold transition hover:bg-orange-50"
              style={ownerTab === t.id ? { background: "#0F172A", color: "#fff" } : { color: "#44403C" }}>
              {t.label}
              {t.id === "overview" && pendingVerifyCount > 0 && (
                <span className="ml-1.5 text-[10px] font-black rounded-full px-1.5 py-0.5 text-white align-middle" style={{ background: "#D97706" }}>⏳ {pendingVerifyCount}</span>
              )}
            </button>
          ))}
        </div>
        {ownerTab === "overview" && (<div className="space-y-6">
        <div className="flex justify-end">
          <GuidelineButton entry="owner-overview" />
        </div>
        <div className="bg-white rounded-2xl border border-orange-100 shadow-sm p-4 flex flex-wrap gap-x-8 gap-y-1 items-center">
          <span className="font-extrabold">📊 Today — {new Date().toLocaleDateString()}</span>
          {shop.hasCanteen && <span>🍽️ Canteen Sales: <b style={{ color: "#F97316" }}>Rs {canteenSales.toLocaleString()}</b></span>}
          {retailOn && <span>🛒 Grocery Sales: <b style={{ color: "#16A34A" }}>Rs {grocerySales.toLocaleString()}</b></span>}
          <span>Combined: <b>Rs {totalSales.toLocaleString()}</b></span>
          <span>🏪 Counter: <b>Rs {counterSales.toLocaleString()}</b></span>
          <span>📦 Low Stock: <b style={{ color: lowStockCount > 0 ? "#DC2626" : "#16A34A" }}>{lowStockCount} items</b> <span className="text-stone-400">(Stock tab mein tafseel)</span></span>
          <span>📱 Online Orders: <b style={{ color: "#1976D2" }}>Rs {onlineOrderSales.toLocaleString()}</b> ({onlineOrders.length}){shop.hasCanteen && <> — 🍔 Online-Canteen <b>Rs {onlineCanteenSales.toLocaleString()}</b></>}{retailOn && <> · 🛒 Online-Grocery <b>Rs {onlineGrocerySales.toLocaleString()}</b></>}</span>
        </div>
        {/* ⏰ Expiry Qareeb — sirf Medical Store setup mein (Stock screen
            wali hi list; yahan sirf tab nazar ata hai jab kuch qareeb ho
            ya hamesha khali tasalli ke liye bhi dikhta hai). */}
        {shop.retailType === "medical" && (
          <section className="bg-white rounded-2xl border-2 border-amber-200 shadow-sm p-4" data-testid="owner-expiry-panel">
            <h2 className="font-extrabold mb-1">⏰ Expiry Qareeb — Dawaiyan</h2>
            {expirySoon.length === 0 ? (
              <p className="text-sm font-bold text-stone-400">✓ Abhi koi dawai expiry ke qareeb nahi (ya kisi stock entry mein expiry nahi di gayi).</p>
            ) : (
              <ul className="space-y-1.5">
                {expirySoon.map((w) => (
                  <li key={w.item.id} data-testid="owner-expiry-row" className="flex items-center gap-2.5 rounded-xl border px-3 py-2"
                    style={{ borderColor: w.daysLeft < 0 ? "#FECACA" : "#FDE68A", background: w.daysLeft < 0 ? "#FEF2F2" : "#FFFBEB" }}>
                    <span className="text-2xl">{w.item.emoji}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-bold text-sm leading-snug">{w.item.name}</span>
                      <span className="block text-xs text-stone-500">Expiry: {expiryLabel(w.expiry)} · Stock {w.item.stock} {w.item.unit === "kg" ? "kg" : "pcs"}</span>
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
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {cards.map((c) => (
            <div key={c.label} className="kpi-3d bg-white rounded-2xl border border-orange-100 shadow-md p-4">
              <div className="flex justify-between items-center"><span className="text-xs font-bold text-stone-500">{c.label}</span><span className="inline-flex items-center justify-center w-9 h-9 rounded-full text-lg shadow-sm" style={{ background: c.color + "22" }}>{c.icon}</span></div>
              <div className="text-2xl font-black mt-1" style={{ color: c.color }}><AnimNum value={c.num} prefix={c.prefix} /></div>
            </div>
          ))}
        </div>


        <PaymentVerificationSection orders={orders} onDone={() => setOrders(loadOrders())} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <section className="bg-white rounded-2xl border border-orange-100 shadow-sm p-4">
            <h2 className="font-extrabold mb-3">🏆 Best Sellers Today</h2>
            {best.length === 0 && <p className="text-stone-400">No sales yet today.</p>}
            <ul className="space-y-2.5">
              {best.map((b, i) => (
                <li key={b.name} className="border-b border-dashed border-stone-200 pb-1.5">
                  <div className="flex justify-between">
                    <span><b>#{i + 1}</b> {b.name}</span><span><b>{b.qty}</b> sold · Rs {Math.round(b.amount).toLocaleString()}</span>
                  </div>
                  <div className="bar-3d h-2 rounded-full mt-1" style={{ width: `${Math.max(8, (b.qty / (best[0]?.qty || 1)) * 100)}%`, background: "#F97316" }} />
                </li>
              ))}
            </ul>
          </section>

          <section className="bg-white rounded-2xl border border-orange-100 shadow-sm p-4">
            <h2 className="font-extrabold mb-3">🧾 Bill History — Today <span className="text-xs font-bold text-stone-400">(click a bill to view / reprint)</span></h2>
            {todays.length === 0 && <p className="text-stone-400">No bills yet today.</p>}
            <ul className="space-y-1 max-h-80 overflow-y-auto">
              {todays.map((o) => (
                <li key={o.id}>
                  <button onClick={() => setViewOrder(o)} className="w-full flex justify-between items-center text-sm border-b border-dashed border-stone-200 py-1.5 hover:bg-orange-50 rounded px-1 text-left">
                    <span><b>{billNoOf(o)}</b> · {new Date(o.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {o.mode === "grocery" ? "🛒 Grocery" : "🍽️ Canteen"}{o.source === "online" ? (o.orderType === "dine-in" ? ` · 🍽️ DINE-IN Table ${o.tableNo} (${o.customerName})` : o.placeLabel ? ` · 🌐 Online — ${o.customerName} — ${o.placeLabel}` : ` · 🥡 Takeaway (${o.customerName})`) : ""} · {o.payment}{o.udhaarName ? ` (${o.udhaarName})` : ""}
                      <span className="ml-1 text-[10px] font-black rounded-full px-2 py-0.5 text-white" style={{ background: o.status === "ready" ? "#16A34A" : "#F59E0B" }}>{o.status.toUpperCase()}</span>
                      {o.paymentStatus === "proof_pending" && <span className="ml-1 text-[10px] font-black rounded-full px-2 py-0.5 text-white" style={{ background: "#D97706" }}>⏳ TASDEEQ BAQI</span>}
                      {o.paymentStatus === "confirmed" && <span className="ml-1 text-[10px] font-black rounded-full px-2 py-0.5 text-white" style={{ background: "#16A34A" }}>✅ PAYMENT CONFIRM</span>}
                      {o.paymentStatus === "rejected" && <span className="ml-1 text-[10px] font-black rounded-full px-2 py-0.5 text-white" style={{ background: "#DC2626" }}>❌ PAYMENT REJECT</span>}
                    </span>
                    <b>Rs {o.total.toLocaleString()} 🖨️</b>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        </div>)}

        {ownerTab === "staff" && (<>
          <div className="flex justify-end mb-3">
            <GuidelineButton entry="owner-staff" />
          </div>
          <StaffAccessSection />
        </>)}

        {ownerTab === "menu" && (
        <section className="bg-white rounded-2xl border border-orange-100 shadow-sm p-4">
          <div className="flex justify-end mb-2">
            <GuidelineButton entry="owner-menu" />
          </div>
          <h2 className="font-extrabold mb-1">🍽️ Menu Management</h2>
          <p className="text-sm mb-3 font-bold" style={{ color: "#F59E0B" }}>⚠️ Current menu is a SAMPLE — replace with Talha&apos;s real menu &amp; prices.</p>
          <div className="flex flex-wrap items-end gap-2 mb-4">
            <label className="block flex-1 min-w-[160px]">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Item Name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Item name" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500" />
            </label>
            <label className="block w-28">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Price (Rs)</span>
              <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="Price Rs" inputMode="numeric" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500" />
            </label>
            <label className="block w-28">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Lagat / Cost Rs</span>
              <input value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} placeholder="Lagat Rs" inputMode="numeric" data-testid="menu-cost-input" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500" />
              <span className="block mt-0.5 text-[10px] font-bold text-stone-400">P&amp;L ke liye — khali = lagat baqi</span>
            </label>
            <label className="block w-16">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Emoji</span>
              <input value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} placeholder="🍔" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 text-center outline-none focus:border-orange-500" />
            </label>
            <label className="block">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Category</span>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Category })} className="rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none">
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <button onClick={saveItem} className="rounded-xl px-5 py-2.5 font-extrabold text-white" style={{ background: "#16A34A" }}>{editId ? "Save Edit" : "+ Add Item"}</button>
            {editId && <button onClick={() => { setEditId(null); setForm({ name: "", price: "", cost: "", category: "Snacks", emoji: "🍽️" }); }} className="rounded-xl px-4 py-2.5 font-bold bg-stone-100">Cancel</button>}
          </div>
          <div className="space-y-1" data-testid="menu-list">
            {menu.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-lg bg-orange-50/60 border border-orange-100 px-3 py-1.5 min-h-11">
                <span className="text-xl w-7 text-center shrink-0">{m.emoji}</span>
                <span className="flex-1 min-w-0 font-bold text-sm leading-snug">{m.name}</span>
                <span className="text-xs text-stone-500 shrink-0">{m.category}</span>
                <span className="text-xs font-bold shrink-0" title="Lagat (cost) — P&L ke liye">{m.cost ? <span className="text-stone-500">Lagat Rs {m.cost}</span> : <span style={{ color: "#D97706" }}>⚠️ Lagat NAHI BHARI</span>}</span>
                <span className="font-extrabold text-sm shrink-0">Rs {m.price}</span>
                <button onClick={() => edit(m)} className="font-bold text-sm px-2 py-1 rounded-lg bg-white border border-stone-200 shrink-0">Edit</button>
                <button onClick={() => del(m.id)} className="font-bold text-sm px-2 py-1 rounded-lg text-white shrink-0" style={{ background: "#DC2626" }}>✕</button>
              </div>
            ))}
          </div>

          {/* ── 🎁 Deals — combo offers (KFC-style) ─────────────────── */}
          <div className="mt-6 border-t-2 border-dashed border-orange-100 pt-4" data-testid="deals-section">
            <h3 className="font-extrabold mb-1">🎁 Deals — Combo Offers</h3>
            <p className="text-sm text-stone-500 mb-3">Kai items mila kar EK deal price — jaise Student Deal, Family Deal. Deal POS + Online + Menu Board par <b>ek line</b> ki tarah bikti hai; Kitchen ko us ke andar ki har cheez alag dikhti hai aur stock bhi asal items se katta hai. Deal band (inactive) karne se woh har jaga se chhup jati hai.</p>
            <div className="flex flex-wrap items-end gap-2 mb-2">
              <label className="block flex-1 min-w-[160px]">
                <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Deal Name</span>
                <input value={dealForm.name} onChange={(e) => setDealForm({ ...dealForm, name: e.target.value })} placeholder="e.g. Student Deal" data-testid="deal-name-input" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500" />
              </label>
              <label className="block w-32">
                <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Deal Price (Rs)</span>
                <input value={dealForm.price} onChange={(e) => setDealForm({ ...dealForm, price: e.target.value.replace(/[^0-9]/g, "") })} placeholder="600" inputMode="numeric" data-testid="deal-price-input" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500" />
              </label>
              <button onClick={saveDeal} data-testid="deal-save-btn" className="rounded-xl px-5 py-2.5 font-extrabold text-white" style={{ background: "#DC2626" }}>{dealEditId ? "Save Edit" : "🎁 Deal Banayein"}</button>
              {dealEditId && <button onClick={() => { setDealEditId(null); setDealForm({ name: "", price: "" }); setDealPicks({}); }} className="rounded-xl px-4 py-2.5 font-bold bg-stone-100">Cancel</button>}
            </div>
            <div className="mb-2">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-1">Deal mein cheezein add karein (qty stepper)</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-64 overflow-y-auto pr-1" data-testid="deal-item-picker">
                {menu.map((m) => {
                  const q = dealPicks[m.id] ?? 0;
                  return (
                    <div key={m.id} className={`flex items-center gap-2 rounded-xl border-2 px-2.5 py-1.5 ${q > 0 ? "border-red-300 bg-red-50/60" : "border-stone-100 bg-white"}`}>
                      <span className="text-lg shrink-0">{m.emoji}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block font-bold text-sm leading-tight">{m.name}</span>
                        <span className="block text-[11px] text-stone-400 font-bold">Rs {m.price}</span>
                      </span>
                      <button onClick={() => setDealPicks((p) => ({ ...p, [m.id]: Math.max(0, (p[m.id] ?? 0) - 1) }))} data-testid={`deal-pick-dec-${m.id}`} className="w-8 h-8 rounded-full bg-white border-2 border-stone-200 font-extrabold shrink-0">−</button>
                      <span className="w-5 text-center font-extrabold" data-testid={`deal-pick-qty-${m.id}`}>{q}</span>
                      <button onClick={() => setDealPicks((p) => ({ ...p, [m.id]: (p[m.id] ?? 0) + 1 }))} data-testid={`deal-pick-inc-${m.id}`} className="w-8 h-8 rounded-full text-white font-extrabold shrink-0" style={{ background: "#DC2626" }}>+</button>
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="text-sm font-bold mb-3" data-testid="deal-readout">
              Cheezon ki kul qeemat: <b>Rs {dealFormValue.toLocaleString()}</b>
              {dealForm.price && parseInt(dealForm.price, 10) > 0 && <> · Deal price: <b style={{ color: "#DC2626" }}>Rs {parseInt(dealForm.price, 10).toLocaleString()}</b> · Bachat: <b style={{ color: "#16A34A" }}>Rs {(dealFormValue - parseInt(dealForm.price, 10)).toLocaleString()}</b></>}
            </p>
            {dealMsg && <p className="text-sm font-bold mb-2" style={{ color: dealMsg.startsWith("✓") ? "#16A34A" : "#DC2626" }}>{dealMsg}</p>}
            <div className="space-y-1.5" data-testid="deals-list">
              {deals.length === 0 && <p className="text-sm font-bold text-stone-400">Abhi koi deal nahi — upar pehli deal banayein.</p>}
              {deals.map((d) => {
                const value = dealValue(d, menu);
                return (
                  <div key={d.id} data-testid="deal-row" className={`flex flex-wrap items-center gap-2 rounded-xl border-2 px-3 py-2 ${d.active ? "border-red-200 bg-red-50/40" : "border-stone-200 bg-stone-50 opacity-70"}`}>
                    <span className="text-2xl">🎁</span>
                    <span className="flex-1 min-w-[180px]">
                      <span className="block font-extrabold leading-tight">{d.name}</span>
                      <span className="block text-xs font-bold text-stone-500 leading-snug">{dealContentsText(d, menu)}</span>
                    </span>
                    <span className="text-right shrink-0">
                      {value > d.price && <s className="block text-xs font-bold text-stone-400">Rs {value.toLocaleString()}</s>}
                      <span className="font-black" style={{ color: "#DC2626" }}>Rs {d.price.toLocaleString()}</span>
                    </span>
                    <button onClick={() => toggleDeal(d)} data-testid="deal-active-toggle" className="font-bold text-xs px-3 py-1.5 rounded-full text-white shrink-0" style={{ background: d.active ? "#16A34A" : "#78716C" }}>{d.active ? "🟢 LIVE" : "⚪ BAND"}</button>
                    <button onClick={() => editDeal(d)} className="font-bold text-sm px-3 py-1.5 rounded-lg bg-white border border-stone-200 shrink-0">Edit</button>
                    <button onClick={() => delDeal(d)} className="font-bold text-sm px-3 py-1.5 rounded-lg text-white shrink-0" style={{ background: "#DC2626" }}>Delete</button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
        )}

        {ownerTab === "grocery" && (
        <section className="bg-white rounded-2xl border border-orange-100 shadow-sm p-4">
          <div className="flex justify-end mb-2">
            <GuidelineButton entry="owner-grocery" />
          </div>
          <h2 className="font-extrabold mb-1">🛒 Grocery Products Management</h2>
          <p className="text-sm mb-3 font-bold" style={{ color: "#F59E0B" }}>⚠️ Current products are SAMPLE — replace with the real grocery list, SKUs &amp; prices.</p>
          <div className="flex flex-wrap items-end gap-2 mb-4">
            <label className="block flex-1 min-w-[150px]">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Product Name</span>
              <input value={gForm.name} onChange={(e) => setGForm({ ...gForm, name: e.target.value })} placeholder="Product name" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500" />
            </label>
            <label className="block w-52">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Brand / Company</span>
              <input value={gForm.brand} onChange={(e) => setGForm({ ...gForm, brand: e.target.value })} placeholder="🏭 Brand / Company (e.g. Sunsilk)" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500" aria-label="Brand" />
            </label>
            <label className="block w-28">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">SKU</span>
              <input value={gForm.sku} onChange={(e) => setGForm({ ...gForm, sku: e.target.value })} placeholder="SKU/PLU" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500" />
            </label>
            <label className="block w-44">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">EAN Barcode</span>
              <input value={gForm.barcode} onChange={(e) => setGForm({ ...gForm, barcode: e.target.value })} placeholder="🏷️ EAN Barcode (packed items)" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500" />
            </label>
            <label className="block w-24">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Retail Price (Rs)</span>
              <input value={gForm.retail} onChange={(e) => setGForm({ ...gForm, retail: e.target.value })} placeholder="Retail Rs" inputMode="numeric" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500" />
            </label>
            <label className="block w-28">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Wholesale Price (Rs)</span>
              <input value={gForm.wholesale} onChange={(e) => setGForm({ ...gForm, wholesale: e.target.value })} placeholder="Wholesale Rs" inputMode="numeric" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500" />
            </label>
            <label className="block w-44">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Wholesale Min Qty</span>
              <input value={gForm.wsMin} onChange={(e) => setGForm({ ...gForm, wsMin: e.target.value })} placeholder="Wholesale min qty (optional)" inputMode="decimal" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500" aria-label="Wholesale minimum quantity" title="Wholesale minimum quantity — khali = shop default" />
            </label>
            <label className="block w-20">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Stock Qty</span>
              <input value={gForm.stock} readOnly placeholder="Stock" inputMode="decimal" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none bg-stone-100 text-stone-500" title="Stock yahan se change NAHI hota — Stock tab se manage karein (Phase 2: stock sirf orders/entries se move hota hai)" aria-label="Stock (Stock tab se manage hota hai)" />
            </label>
            <label className="block">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Unit</span>
              <select value={gForm.unit} onChange={(e) => setGForm({ ...gForm, unit: e.target.value as "piece" | "kg" })} className="rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none">
                <option value="piece">per piece</option>
                <option value="kg">per kg</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Main Head</span>
              <select value={gForm.headId} onChange={(e) => { const hid = e.target.value; setGForm({ ...gForm, headId: hid, subId: subs.find((s) => s.headId === hid)?.id ?? "" }); }} className="rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500 font-bold" aria-label="Head">
                {heads.map((h) => <option key={h.id} value={h.id}>{h.emoji} {h.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Sub-Head</span>
              <select value={gForm.subId} onChange={(e) => setGForm({ ...gForm, subId: e.target.value })} className="rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500 font-bold" aria-label="Sub-Head" disabled={subsOfHead(gForm.headId).length === 0}>
                {subsOfHead(gForm.headId).length
                  ? subsOfHead(gForm.headId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)
                  : <option value="">— pehle is head mein sub-head add karein —</option>}
              </select>
            </label>
            <label className="block w-14">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Emoji</span>
              <input value={gForm.emoji} onChange={(e) => setGForm({ ...gForm, emoji: e.target.value })} className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 text-center outline-none focus:border-orange-500" />
            </label>
            <label className="block flex-1 min-w-[220px]">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Image URL (optional)</span>
              <input value={gForm.image} onChange={(e) => setGForm({ ...gForm, image: e.target.value })} placeholder="🖼️ Image URL (optional — na ho to sub-head/head ki picture lagegi)" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500" aria-label="Product image URL" />
            </label>
            <label className="flex items-center gap-2.5 rounded-xl border-2 border-orange-200 bg-orange-50 px-3.5 py-2.5 cursor-pointer" data-testid="board-offer-toggle">
              <input type="checkbox" checked={gForm.boardOffer} onChange={(e) => setGForm({ ...gForm, boardOffer: e.target.checked })} className="w-5 h-5 shrink-0 accent-orange-500" />
              <span className="font-bold text-sm">📺 Menu Board ki Offers slide mein dikhayein</span>
            </label>
            <label className="block w-52">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Offer Price Rs</span>
              <input value={gForm.offerPrice} onChange={(e) => setGForm({ ...gForm, offerPrice: e.target.value })} placeholder="Offer Price (Rs)" inputMode="numeric" data-testid="offer-price-input" aria-label="Offer Price (Rs)" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500" />
              <span className="block text-[11px] font-bold text-stone-400 mt-1">Khali ya Retail se zyada = offer price nahi lagega</span>
            </label>
            {shop.retailType === "mobile" && (
              <label className="flex items-center gap-2.5 rounded-xl border-2 border-blue-200 bg-blue-50 px-3.5 py-2.5 cursor-pointer" data-testid="track-serial-wrap">
                <input type="checkbox" checked={gForm.trackSerial} onChange={(e) => setGForm({ ...gForm, trackSerial: e.target.checked })} data-testid="track-serial-toggle" className="w-5 h-5 shrink-0 accent-blue-600" />
                <span className="font-bold text-sm">📱 IMEI / Serial lazmi — bikri par har unit ka serial likha jayega aur bill par print hoga</span>
              </label>
            )}
            <button onClick={saveGItem} className="rounded-xl px-5 py-2.5 font-extrabold text-white" style={{ background: "#16A34A" }}>{gEditId ? "Save Edit" : "+ Add Product"}</button>
            {gEditId && <button onClick={resetGForm} className="rounded-xl px-4 py-2.5 font-bold bg-stone-100">Cancel</button>}
            {/* Packings editor — sizes of THIS product (not separate items) */}
            <div className="w-full rounded-2xl border-2 border-dashed border-stone-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <span className="font-extrabold text-sm">📦 Packings (sizes) — optional</span>
                <button onClick={() => setGPackings((p) => [...p, { label: "", retail: "", wholesale: "", barcode: "", containsQty: "", wsMin: "" }])} className="rounded-lg px-3 py-1.5 text-white text-sm font-bold" style={{ background: "#16A34A" }}>+ Packing</button>
              </div>
              <p className="text-xs text-stone-500 mb-2">Size alag item NAHI hota — packing isi product ki hoti hai (e.g. Surf Excel: 500g / 1kg / 2kg). Har packing ka apna <b>barcode</b> ho sakta hai. <b>Contains</b> = is packing ke andar kitne sealed packs hain (sab se chhota sealed pack = 1, Full Dabba = utne packs) — stock inhi base packs mein ginta hai. Khali chhor dein to product base price par bikega.</p>
              {gPackings.map((p, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2 mb-2">
                  <label className="block w-36">
                    <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Packing / Size</span>
                    <input placeholder="Label (e.g. 1kg)" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2" value={p.label} onChange={(e) => setGPackings((rows) => rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))} />
                  </label>
                  <label className="block w-28">
                    <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Retail Price (Rs)</span>
                    <input placeholder="Retail Rs" inputMode="numeric" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2" value={p.retail} onChange={(e) => setGPackings((rows) => rows.map((r, j) => (j === i ? { ...r, retail: e.target.value } : r)))} />
                  </label>
                  <label className="block w-32">
                    <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Wholesale Price (Rs)</span>
                    <input placeholder="Wholesale Rs" inputMode="numeric" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2" value={p.wholesale} onChange={(e) => setGPackings((rows) => rows.map((r, j) => (j === i ? { ...r, wholesale: e.target.value } : r)))} />
                  </label>
                  <label className="block w-40">
                    <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Barcode</span>
                    <input placeholder="🏷️ Packing barcode" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2" value={p.barcode} onChange={(e) => setGPackings((rows) => rows.map((r, j) => (j === i ? { ...r, barcode: e.target.value } : r)))} aria-label="Packing barcode" />
                  </label>
                  <label className="block w-32">
                    <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Contains (packs)</span>
                    <input placeholder="Contains (packs)" inputMode="numeric" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2" value={p.containsQty} onChange={(e) => setGPackings((rows) => rows.map((r, j) => (j === i ? { ...r, containsQty: e.target.value } : r)))} aria-label="Contains quantity (sealed packs)" title="Is packing mein kitne sealed packs hain" />
                  </label>
                  <label className="block w-32">
                    <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">WS Min (packs)</span>
                    <input placeholder="WS min (packs)" inputMode="numeric" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2" value={p.wsMin} onChange={(e) => setGPackings((rows) => rows.map((r, j) => (j === i ? { ...r, wsMin: e.target.value } : r)))} aria-label="Packing wholesale minimum" title="Is packing ki wholesale minimum (packs) — khali = product/shop default" />
                  </label>
                  <button onClick={() => setGPackings((rows) => rows.filter((_, j) => j !== i))} className="rounded-lg px-3 py-2 font-bold text-white" style={{ background: "#DC2626" }} aria-label="Remove packing">✕</button>
                </div>
              ))}
            </div>
            {/* Variants editor (Phase 2) — flavours/types under this master.
                Brand + item = the master; variants (Black / Pink / Mango…)
                each carry their own packings + barcodes. Shown while
                editing an existing product. */}
            {gEditId && (() => {
              const prod = grocery.find((g) => g.id === gEditId);
              const vars = prod?.variants ?? [];
              return (
                <div className="w-full rounded-2xl border-2 border-dashed border-violet-200 p-3">
                  <div className="font-extrabold text-sm mb-1">🎨 Variants (flavours / types) — {prod?.name}</div>
                  <p className="text-xs text-stone-500 mb-2">Ek hi brand ke flavours alag products NAHI hote — isi master ke variants hote hain (e.g. Sunsilk Shampoo: Black / Pink / White). Product jis ke flavours na hon us ka sirf <b>Standard</b> variant rehta hai.</p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {vars.map((v) => (
                      <span key={v.name} className="rounded-full bg-violet-50 border border-violet-200 px-3 py-1 text-xs font-bold">
                        {v.name}{v.name === "Standard" ? " (default)" : ""} · {v.packings.length} packings
                      </span>
                    ))}
                    {vars.length === 0 && <span className="text-xs text-stone-400 font-bold">Standard (default)</span>}
                  </div>
                  <div className="flex flex-wrap items-end gap-2 mb-2">
                    <label className="block w-56">
                      <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">New Variant Name</span>
                      <input value={variantDraft} onChange={(e) => setVariantDraft(e.target.value)} placeholder="Naya variant (e.g. Black, Mango)" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2 outline-none focus:border-violet-400" aria-label="New variant name" />
                    </label>
                    <button onClick={addVariant} className="rounded-lg px-3 py-2 text-white text-sm font-bold" style={{ background: "#7C3AED" }}>+ Variant Add</button>
                  </div>
                  <div className="flex flex-wrap gap-2 items-end">
                    <label className="block">
                      <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Variant</span>
                      <select value={vpForm.variant} onChange={(e) => setVpForm({ ...vpForm, variant: e.target.value })} className="rounded-xl border-2 border-stone-200 px-3 py-2 outline-none font-bold" aria-label="Variant for new packing">
                        {vars.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
                      </select>
                    </label>
                    <label className="block w-32">
                      <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Packing / Size</span>
                      <input value={vpForm.label} onChange={(e) => setVpForm({ ...vpForm, label: e.target.value })} placeholder="Packing label" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2 outline-none focus:border-violet-400" aria-label="Variant packing label" />
                    </label>
                    <label className="block w-24">
                      <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Retail Price (Rs)</span>
                      <input value={vpForm.retail} onChange={(e) => setVpForm({ ...vpForm, retail: e.target.value })} placeholder="Retail Rs" inputMode="numeric" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2 outline-none focus:border-violet-400" aria-label="Variant packing retail" />
                    </label>
                    <label className="block w-28">
                      <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Wholesale Price (Rs)</span>
                      <input value={vpForm.wholesale} onChange={(e) => setVpForm({ ...vpForm, wholesale: e.target.value })} placeholder="Wholesale Rs" inputMode="numeric" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2 outline-none focus:border-violet-400" aria-label="Variant packing wholesale" />
                    </label>
                    <label className="block w-36">
                      <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Barcode</span>
                      <input value={vpForm.barcode} onChange={(e) => setVpForm({ ...vpForm, barcode: e.target.value })} placeholder="🏷️ Barcode" className="w-full rounded-xl border-2 border-stone-200 px-3 py-2 outline-none focus:border-violet-400" aria-label="Variant packing barcode" />
                    </label>
                    <button onClick={addVariantPacking} className="rounded-lg px-3 py-2 text-white text-sm font-bold" style={{ background: "#7C3AED" }}>+ Variant Packing</button>
                  </div>
                  {variantMsg && <p className="text-xs font-bold mt-2" style={{ color: "#7C3AED" }}>{variantMsg}</p>}
                </div>
              );
            })()}
          </div>
          {/* Products list — compact TABLE (one ~42px row per product) with
              search / head / sub-head filters + pagination. Cards made this
              page enormous at 622 products. */}
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <input value={prodSearch} onChange={(e) => { setProdSearch(e.target.value); setProdPage(1); }} placeholder="🔍 Product / SKU / barcode search…" className="rounded-xl border-2 border-stone-200 px-3 py-2 flex-1 min-w-[180px] outline-none focus:border-orange-500" data-testid="prod-search" aria-label="Products search" />
            <select value={prodHead} onChange={(e) => { setProdHead(e.target.value); setProdSub("all"); setProdPage(1); }} className="rounded-xl border-2 border-stone-200 px-3 py-2 font-bold outline-none focus:border-orange-500" aria-label="Products head filter">
              <option value="all">Saare Heads</option>
              {heads.map((h) => <option key={h.id} value={h.id}>{h.emoji} {h.name}</option>)}
            </select>
            <select value={prodSub} onChange={(e) => { setProdSub(e.target.value); setProdPage(1); }} className="rounded-xl border-2 border-stone-200 px-3 py-2 font-bold outline-none focus:border-orange-500" aria-label="Products sub-head filter" disabled={prodHead === "all"}>
              <option value="all">Saare Sub-Heads</option>
              {subs.filter((s) => s.headId === prodHead).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <span className="font-bold text-sm text-stone-500" data-testid="prod-count">{prodFiltered.length} product{prodFiltered.length === 1 ? "" : "s"}{prodFiltered.length !== grocery.length ? ` (kul ${grocery.length})` : ""}</span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-orange-100">
            <table className="w-full text-sm border-collapse min-w-[760px]" data-testid="grocery-products-table">
              <thead>
                <tr className="text-white text-left text-xs uppercase tracking-wide" style={{ background: "#0F172A" }}>
                  <th className="px-3 py-2 font-extrabold">Product</th>
                  <th className="px-2 py-2 font-extrabold">SKU</th>
                  <th className="px-2 py-2 font-extrabold">Retail</th>
                  <th className="px-2 py-2 font-extrabold">WS</th>
                  <th className="px-2 py-2 font-extrabold">Stock</th>
                  <th className="px-2 py-2 font-extrabold">Head › Sub</th>
                  <th className="px-2 py-2 font-extrabold">Packings</th>
                  <th className="px-2 py-2 font-extrabold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {prodPageItems.map((g) => {
                  const hd = heads.find((h) => h.id === g.headId);
                  const sb = subs.find((s) => s.id === g.subId);
                  const packCount = (g.packings?.length ?? 0) > 0 ? (g.packings?.length ?? 0) : (g.variants ?? []).reduce((n, v) => n + v.packings.length, 0);
                  const variantNames = (g.variants ?? []).filter((v) => v.name !== "Standard").map((v) => v.name);
                  const low = g.stock <= (g.lowStock ?? (g.unit === "kg" ? 2 : 5));
                  return (
                    <tr key={g.id} className="border-t border-orange-50 hover:bg-orange-50/70 h-[42px]" data-testid="grocery-product-row">
                      <td className="px-3 py-1 max-w-[260px]">
                        <span className="flex items-center gap-2 min-w-0">
                          {g.image
                            ? <img src={g.image} alt="" className="w-7 h-7 rounded-md object-cover shrink-0 border border-orange-100" />
                            : <span className="w-7 text-center text-lg shrink-0">{g.emoji}</span>}
                          <span className="font-bold leading-snug">{g.name}{variantNames.length ? <span className="font-bold text-violet-500 text-xs"> 🎨 {variantNames.join(", ")}</span> : ""}</span>
                          {g.boardOffer && <span className="shrink-0 text-[10px] font-black px-1.5 py-0.5 rounded-full text-white" style={{ background: "#DC2626" }} title="Menu Board ki Offers slide mein hai">🎉 OFFER{offerActive(g) ? ` Rs ${g.offerPrice}` : ""}</span>}
                          {g.trackSerial && <span className="shrink-0 text-[10px] font-black px-1.5 py-0.5 rounded-full text-white" style={{ background: "#1976D2" }} title="Bikri par IMEI/serial lazmi hai">📱 IMEI</span>}
                        </span>
                      </td>
                      <td className="px-2 py-1 font-mono text-xs text-stone-500">{g.sku}</td>
                      <td className="px-2 py-1 font-extrabold whitespace-nowrap">Rs {g.retailPrice}</td>
                      <td className="px-2 py-1 whitespace-nowrap text-stone-600">Rs {g.wholesalePrice}</td>
                      <td className="px-2 py-1 whitespace-nowrap font-bold" style={{ color: low ? "#DC2626" : undefined }}>{g.stock} {g.unit}</td>
                      <td className="px-2 py-1 text-xs text-stone-500 max-w-[170px]"><span className="block leading-snug">{hd ? `${hd.emoji} ${hd.name}` : "—"}{sb ? ` › ${sb.name}` : ""}</span></td>
                      <td className="px-2 py-1 whitespace-nowrap">{packCount ? `📦 ${packCount}` : "—"}</td>
                      <td className="px-2 py-1">
                        <span className="flex gap-1 justify-end">
                          <button onClick={() => toggleBoardOffer(g)} aria-pressed={!!g.boardOffer} data-testid="board-offer-quick-toggle" title={g.boardOffer ? "Menu Board Offers se hatayein" : "Menu Board ki Offers slide mein dikhayein"}
                            className="font-bold text-xs px-2 py-1 rounded-lg border" style={g.boardOffer ? { background: "#DC2626", color: "#fff", borderColor: "#DC2626" } : { background: "#fff", borderColor: "#E7E5E4" }}>🎉</button>
                          <button onClick={() => setSheet([{ item: g, copies: 1 }])} className="font-bold text-xs px-2 py-1 rounded-lg bg-white border border-stone-200">🏷️ Label</button>
                          <button onClick={() => editG(g)} className="font-bold text-xs px-2 py-1 rounded-lg bg-white border border-stone-200">Edit</button>
                          <button onClick={() => delG(g.id)} className="font-bold text-xs px-2 py-1 rounded-lg text-white" style={{ background: "#DC2626" }}>✕</button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {prodPageItems.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-4 text-center font-bold text-stone-400">Is filter mein koi product nahi.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-2" data-testid="prod-pagination">
            <button onClick={() => setProdPage((p) => Math.max(1, p - 1))} disabled={prodPageSafe <= 1} className="rounded-xl px-4 py-2 font-extrabold border-2 border-stone-200 disabled:opacity-40">← Prev</button>
            <span className="font-bold text-sm">Page {prodPageSafe} of {prodTotalPages}</span>
            <button onClick={() => setProdPage((p) => Math.min(prodTotalPages, p + 1))} disabled={prodPageSafe >= prodTotalPages} className="rounded-xl px-4 py-2 font-extrabold border-2 border-stone-200 disabled:opacity-40">Next →</button>
            <span className="text-xs font-bold text-stone-400">{prodFiltered.length === 0 ? 0 : (prodPageSafe - 1) * PROD_PAGE_SIZE + 1}–{Math.min(prodFiltered.length, prodPageSafe * PROD_PAGE_SIZE)} of {prodFiltered.length}</span>
          </div>
        </section>
        )}

        {ownerTab === "udhaar" && (<>
          <div className="flex justify-end mb-3">
            <GuidelineButton entry="owner-udhaar" />
          </div>
          <UdhaarKhataSection />
        </>)}

        {ownerTab === "pnl" && (<>
          <div className="flex justify-end mb-3">
            <GuidelineButton entry="owner-pnl" />
          </div>
          <ProfitLossSection shop={shop} />
        </>)}

        {/* Grocery Heads manager — compact: ONE row per head (~40px),
            sub-heads collapsed until the head is expanded (▶) */}
        {ownerTab === "heads" && (
        <div className="rounded-2xl border-2 border-dashed border-stone-200 bg-white p-3 mb-4" data-testid="heads-manager">
          <div className="flex justify-end mb-2">
            <GuidelineButton entry="owner-heads" />
          </div>
          <div className="font-extrabold mb-1">🗂️ Grocery Heads — apna head khud banayein</div>
          <p className="text-xs text-stone-500 mb-2">Structure: <b>Main Head → Sub Head → Product</b> — head / sub-head tab delete hoga jab us mein <b>0 products</b> hon; pehle products ko Edit karke shift karein. Sub-heads dekhne ke liye head ke ▶ par click karein.</p>
          <div className="space-y-1 mb-3">
            {heads.map((h) => {
              const hSubs = subsOfHead(h.id);
              const expanded = !!expandedHeads[h.id];
              const subSummary = hSubs.map((s) => `${s.name} · ${subCount(s.id)}`).join(" | ");
              return (
                <div key={h.id} className="rounded-xl border border-stone-100" style={{ background: h.tint }}>
                  {headEditId === h.id ? (
                    <div className="flex flex-wrap items-center gap-2 px-2.5 py-1.5">
                      <input value={headEditName} onChange={(e) => setHeadEditName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") renameHead(); }}
                        className="rounded-lg border-2 border-stone-200 px-2.5 py-1.5 font-bold flex-1 min-w-[140px] outline-none focus:border-orange-500 bg-white" autoFocus />
                      <input value={headEditImg} onChange={(e) => setHeadEditImg(e.target.value)} placeholder="🖼️ Image URL (optional)"
                        className="rounded-lg border-2 border-stone-200 px-2.5 py-1.5 flex-1 min-w-[140px] outline-none focus:border-orange-500 bg-white" aria-label="Head image URL" />
                      <button onClick={renameHead} className="font-bold text-sm px-3 py-1.5 rounded-lg text-white" style={{ background: "#16A34A" }}>Save</button>
                      <button onClick={() => setHeadEditId(null)} className="font-bold text-sm px-3 py-1.5 rounded-lg bg-white border border-stone-200">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 px-2.5 h-10" data-testid="head-row">
                      <button onClick={() => setExpandedHeads((s) => ({ ...s, [h.id]: !s[h.id] }))} aria-expanded={expanded} aria-label={`${h.name} ke sub-heads ${expanded ? "band karein" : "kholain"}`}
                        className="w-6 h-6 shrink-0 rounded-md bg-white/85 border border-stone-200 text-[10px] font-black">{expanded ? "▼" : "▶"}</button>
                      <span className="text-lg shrink-0">{h.emoji}</span>
                      <span className="font-extrabold text-sm leading-snug">{h.name}</span>
                      <span className="text-[11px] font-black rounded-full bg-white/85 border border-stone-200 px-2 py-0.5 shrink-0 whitespace-nowrap">{headCount(h.id)} products</span>
                      <span className="hidden lg:block flex-1 min-w-0 text-xs text-stone-500 leading-snug">{subSummary || "Koi sub-head nahi"}</span>
                      <span className="ml-auto flex gap-1.5 shrink-0">
                        <button onClick={() => { setHeadEditId(h.id); setHeadEditName(h.name); setHeadEditImg(h.image ?? ""); setHeadMsg(""); }} className="font-bold text-xs px-2.5 py-1 rounded-lg bg-white border border-stone-200">Rename</button>
                        <button onClick={() => deleteHead(h)} className="font-bold text-xs px-2.5 py-1 rounded-lg text-white" style={{ background: "#DC2626" }}>Delete</button>
                      </span>
                    </div>
                  )}
                  {expanded && headEditId !== h.id && (
                    <div className="ml-8 mr-2 mb-2 space-y-1 rounded-lg bg-white/70 border border-stone-100 p-1.5">
                      {hSubs.map((s) => (
                        <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-md bg-white/90 border border-stone-100 px-2 py-0.5 min-h-8" data-testid="sub-row">
                          {subEditId === s.id ? (
                            <>
                              <input value={subEditName} onChange={(e) => setSubEditName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") renameSub(); }}
                                className="rounded-lg border-2 border-stone-200 px-2.5 py-1 font-bold flex-1 min-w-[120px] outline-none focus:border-orange-500 bg-white" autoFocus />
                              <input value={subEditImg} onChange={(e) => setSubEditImg(e.target.value)} placeholder="🖼️ Image URL (optional)"
                                className="rounded-lg border-2 border-stone-200 px-2.5 py-1 flex-1 min-w-[120px] outline-none focus:border-orange-500 bg-white" aria-label="Sub-head image URL" />
                              <button onClick={renameSub} className="font-bold text-xs px-2.5 py-1.5 rounded-lg text-white shrink-0" style={{ background: "#16A34A" }}>Save</button>
                              <button onClick={() => setSubEditId(null)} className="font-bold text-xs px-2.5 py-1.5 rounded-lg bg-white border border-stone-200 shrink-0">Cancel</button>
                            </>
                          ) : (
                            <>
                              <span className="font-bold text-xs leading-snug">↳ {s.name}</span>
                              <span className="text-[11px] font-bold text-stone-500 whitespace-nowrap">· {subCount(s.id)} products</span>
                              <span className="ml-auto flex gap-1.5 shrink-0">
                                <button onClick={() => { setSubEditId(s.id); setSubEditName(s.name); setSubEditImg(s.image ?? ""); setHeadMsg(""); }} className="font-bold text-[11px] px-2 py-1 rounded-md bg-white border border-stone-200">Rename</button>
                                <button onClick={() => deleteSub(s)} className="font-bold text-[11px] px-2 py-1 rounded-md text-white" style={{ background: "#DC2626" }}>Delete</button>
                              </span>
                            </>
                          )}
                        </div>
                      ))}
                      {hSubs.length === 0 && <div className="text-xs font-bold text-stone-400 px-1 py-0.5">Koi sub-head nahi — pehle sub-head add karein, tabhi is head mein product aayega</div>}
                      <div className="flex items-center gap-1.5 px-0.5 pt-0.5">
                        <input value={subDrafts[h.id] ?? ""} onChange={(e) => setSubDrafts((d) => ({ ...d, [h.id]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") addSub(h.id); }}
                          placeholder={`"${h.name}" mein naya sub-head…`} aria-label={`${h.name} mein sub-head add karein`}
                          className="rounded-lg border-2 border-stone-200 px-2.5 py-1.5 text-xs font-bold flex-1 min-w-[140px] outline-none focus:border-orange-500 bg-white" />
                        <button onClick={() => addSub(h.id)} className="rounded-lg px-2.5 py-1.5 text-xs font-extrabold text-white shrink-0" style={{ background: "#0F172A" }}>+ Add Sub-Head</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <input value={headName} onChange={(e) => setHeadName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addHead(); }} placeholder="Naye head ka naam (e.g. Baby Care)" className="rounded-xl border-2 border-stone-200 px-3 py-2.5 flex-1 min-w-[190px] outline-none focus:border-orange-500" />
            <input value={headImage} onChange={(e) => setHeadImage(e.target.value)} placeholder="🖼️ Head Image URL (optional)" className="rounded-xl border-2 border-stone-200 px-3 py-2.5 flex-1 min-w-[170px] outline-none focus:border-orange-500" aria-label="New head image URL" />
            <div className="flex flex-wrap gap-1">
              {HEAD_EMOJIS.map((e) => (
                <button key={e} onClick={() => setHeadEmoji(e)} className="w-9 h-9 rounded-lg text-lg border-2 transition" aria-label={`Emoji ${e}`}
                  style={headEmoji === e ? { background: "#F97316", borderColor: "#F97316" } : { background: "#fff", borderColor: "#E7E5E4" }}>{e}</button>
              ))}
            </div>
            <button onClick={addHead} className="rounded-xl px-4 py-2.5 font-extrabold text-white" style={{ background: "#0F172A" }}>+ Add Head</button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={subHeadSel} onChange={(e) => setSubHeadSel(e.target.value)} className="rounded-xl border-2 border-stone-200 px-3 py-2.5 font-bold outline-none focus:border-orange-500" aria-label="Sub-head ka head">
              {heads.map((h) => <option key={h.id} value={h.id}>{h.emoji} {h.name}</option>)}
            </select>
            <input value={subName} onChange={(e) => setSubName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addSub(); }} placeholder="Naye sub-head ka naam (e.g. Powder)" className="rounded-xl border-2 border-stone-200 px-3 py-2.5 flex-1 min-w-[190px] outline-none focus:border-orange-500" />
            <input value={subImage} onChange={(e) => setSubImage(e.target.value)} placeholder="🖼️ Sub-Head Image URL (optional)" className="rounded-xl border-2 border-stone-200 px-3 py-2.5 flex-1 min-w-[170px] outline-none focus:border-orange-500" aria-label="New sub-head image URL" />
            <button onClick={() => addSub()} className="rounded-xl px-4 py-2.5 font-extrabold text-white" style={{ background: "#0F172A" }}>+ Add Sub-Head</button>
          </div>
          {headMsg && <p className="mt-2 text-sm font-bold" style={{ color: headMsg.startsWith("✓") ? "#16A34A" : "#DC2626" }}>{headMsg}</p>}
        </div>
        )}

        {/* Barcode Labels — bulk sticker printing (label printer) */}
        {ownerTab === "labels" && (
        <div className="rounded-2xl border-2 border-dashed border-stone-200 bg-white p-3 mt-4" data-testid="label-panel">
          <div className="flex justify-end mb-2">
            <GuidelineButton entry="owner-labels" />
          </div>
          <div className="font-extrabold mb-1">🏷️ Barcode Labels — stickers print karein</div>
          <p className="text-xs text-stone-500 mb-2">Products select karein, har product ke stickers ki tadaad set karein, phir print sheet kholein. Har sticker par product ka <b>naam</b>, <b>retail price</b> aur <b>asli scannable Code128 barcode</b> (product ka barcode — na ho to SKU) print hota hai. Sticker size <b>50mm × 30mm</b>; print <b>label printer</b> par hoga (is prototype mein browser print se). Ek product ka label us ki row ke <b>🏷️ Label</b> button se bhi khulta hai.</p>
          <div className="flex flex-wrap gap-2 mb-2">
            <input value={labelSearch} onChange={(e) => setLabelSearch(e.target.value)} placeholder="🔍 Product search…" className="rounded-xl border-2 border-stone-200 px-3 py-2 flex-1 min-w-[150px] outline-none focus:border-orange-500" />
            <select value={labelHead} onChange={(e) => { setLabelHead(e.target.value); setLabelSub("all"); }} className="rounded-xl border-2 border-stone-200 px-3 py-2 font-bold outline-none" aria-label="Label head filter">
              <option value="all">Saare Heads</option>
              {heads.map((h) => <option key={h.id} value={h.id}>{h.emoji} {h.name}</option>)}
            </select>
            <select value={labelSub} onChange={(e) => setLabelSub(e.target.value)} className="rounded-xl border-2 border-stone-200 px-3 py-2 font-bold outline-none" aria-label="Label sub-head filter" disabled={labelHead === "all"}>
              <option value="all">Saare Sub-Heads</option>
              {subs.filter((s) => s.headId === labelHead).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="max-h-[260px] overflow-auto space-y-1 mb-2" data-testid="label-picker-list">
            {labelVisible.map((g) => {
              const on = labelSel[g.id] !== undefined;
              return (
                <label key={g.id} className="flex items-center gap-2 rounded-lg bg-orange-50/60 border border-orange-100 px-2.5 py-1.5 cursor-pointer">
                  <input type="checkbox" checked={on} onChange={(e) => toggleLabel(g.id, e.target.checked)} className="w-4 h-4 shrink-0" />
                  <span className="text-lg">{g.emoji}</span>
                  <span className="flex-1 min-w-0">
                    <span className="font-bold text-sm block leading-snug">{g.name}</span>
                    <span className="text-xs text-stone-500">🏷️ {g.barcode || g.sku} · Rs {g.retailPrice}{g.unit === "kg" ? "/kg" : ""}</span>
                  </span>
                  {on && (
                    <span className="flex items-center gap-1 text-xs font-bold shrink-0" onClick={(e) => e.preventDefault()}>
                      Stickers:
                      <input type="number" min={1} max={500} value={labelSel[g.id]} aria-label={`Stickers for ${g.name}`}
                        onChange={(e) => setLabelSel((sel) => ({ ...sel, [g.id]: Math.max(1, parseInt(e.target.value, 10) || 1) }))}
                        className="w-16 rounded-lg border-2 border-stone-200 px-2 py-1 bg-white" />
                    </span>
                  )}
                </label>
              );
            })}
            {labelVisible.length === 0 && <p className="text-sm font-bold text-stone-400">Is filter mein koi product nahi.</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setLabelSel((sel) => { const next = { ...sel }; labelVisible.forEach((g) => { next[g.id] = next[g.id] ?? 1; }); return next; })} className="rounded-xl px-3.5 py-2.5 font-bold border-2 border-stone-200">☑️ Visible sab select</button>
            <button onClick={() => setLabelSel({})} className="rounded-xl px-3.5 py-2.5 font-bold border-2 border-stone-200">✕ Clear</button>
            <button onClick={() => { if (labelEntries.length) setSheet(labelEntries); }} disabled={labelEntries.length === 0}
              className="rounded-xl px-5 py-2.5 font-extrabold text-white disabled:opacity-40" style={{ background: "#0F172A" }}>
              🖨️ Print Labels ({labelEntries.length} products · {labelTotal} stickers)
            </button>
          </div>
        </div>
        )}

        {/* Barcode label print sheet — screen preview = print layout (50×30mm) */}
        {sheet && (
          <div className="fixed inset-0 z-50 bg-black/60 overflow-auto p-3" role="dialog" aria-label="Barcode labels print sheet">
            <style>{`@media print { body * { visibility: hidden !important; } #label-sheet-area, #label-sheet-area * { visibility: visible !important; } #label-sheet-area { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; } } @page { margin: 3mm; }`}</style>
            <div className="max-w-4xl mx-auto">
              <div className="bg-white rounded-2xl p-4 mb-3 flex flex-wrap items-center gap-3 print:hidden">
                <span className="font-extrabold">🏷️ Barcode Labels — {sheet.length} product{sheet.length === 1 ? "" : "s"} · {sheet.reduce((s, e) => s + e.copies, 0)} stickers</span>
                <label className="font-bold text-sm flex items-center gap-2">Har product ke stickers:
                  <input type="number" min={1} max={500} value={sheet[0]?.copies ?? 1} data-testid="sheet-copies" aria-label="Stickers per product"
                    onChange={(e) => { const v = Math.max(1, parseInt(e.target.value, 10) || 1); setSheet((sh) => (sh ? sh.map((en) => ({ ...en, copies: v })) : sh)); }}
                    className="w-20 rounded-xl border-2 border-stone-200 px-2.5 py-2" />
                </label>
                <button onClick={() => window.print()} className="rounded-xl px-5 py-2.5 font-extrabold text-white" style={{ background: "#0F172A" }}>🖨️ Print</button>
                <button onClick={() => setSheet(null)} className="rounded-xl px-4 py-2.5 font-bold border-2 border-stone-200">✕ Band karein</button>
                <p className="w-full text-xs text-stone-500">Sticker size <b>50mm × 30mm</b>. Ye labels <b>label printer</b> par print honge — print dialog mein apna label printer select karein (is prototype mein browser print use hota hai). Har sticker ka barcode asli Code128 hai — counter scanner se scan hoga.</p>
              </div>
              <div id="label-sheet-area" className="bg-white rounded-2xl p-3">
                <div className="flex flex-wrap" style={{ gap: "2mm" }}>
                  {sheet.flatMap((e) => Array.from({ length: e.copies }, () => e.item)).map((it, i) => (
                    <div key={i} data-testid="label-sticker" style={{ width: "50mm", height: "30mm", border: "1px solid #E7E5E4", padding: "1.6mm 2.5mm", boxSizing: "border-box", overflow: "hidden", background: "#fff" }}>
                      <div style={{ fontWeight: 800, fontSize: "11px", lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.name}</div>
                      <div style={{ fontWeight: 900, fontSize: "12.5px", lineHeight: 1.2 }}>Rs {it.retailPrice}{it.unit === "kg" ? " /kg" : ""}</div>
                      <div style={{ marginTop: "0.8mm" }}><Barcode128 value={it.barcode || it.sku} height={32} /></div>
                      <div style={{ textAlign: "center", fontFamily: "monospace", fontSize: "8.5px", letterSpacing: "1px", marginTop: "0.4mm" }}>{it.barcode || it.sku}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
        {/* Shop Settings — Talha sets the real names here himself, no code editing */}
        {ownerTab === "settings" && (
        <section className="bg-white rounded-2xl border border-orange-100 shadow-sm p-4">
          <div className="flex justify-end mb-2">
            <GuidelineButton entry="owner-settings" />
          </div>
          <h2 className="font-extrabold mb-1">🏷️ Shop Settings — Names</h2>
          <p className="text-sm text-stone-500 mb-3">Set the real names here — they update <b>everywhere</b>: top header, bill headers, table QR cards and the Online Order page. No code editing needed.</p>
          {/* Shop Status — closed-shop popup switch + contact number (Talha, 14 Nov 2026) */}
          <div className="mb-4 rounded-2xl border-2 p-3" style={shopForm.shopOpen ? { borderColor: "#BBF7D0", background: "#F0FDF4" } : { borderColor: "#FECACA", background: "#FEF2F2" }}>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="min-w-[220px] flex-1">
                <div className="font-extrabold text-base">🚪 Shop Status — {shopForm.shopOpen ? "🟢 Khuli hai" : "🔴 Band hai"}</div>
                <p className="text-sm text-stone-500">Band karte hi online customers ko ordering ki jagah <b>“Abhi band hai”</b> wala popup nazar ayega — neeche wale number ke sath. Toggle <b>foran</b> lag jata hai, Save dabana zaroori nahi.</p>
              </div>
              <button onClick={() => { const next = !shopForm.shopOpen; setShopForm({ ...shopForm, shopOpen: next }); saveShop({ ...loadShop(), shopOpen: next }); }}
                className="rounded-2xl px-6 py-3.5 font-black text-white text-lg shadow" style={{ background: shopForm.shopOpen ? "#DC2626" : "#16A34A" }}>
                {shopForm.shopOpen ? "🔴 Band kar dein" : "🟢 Khol dein"}
              </button>
            </div>
            <label className="block mt-3">
              <span className="text-xs font-extrabold text-stone-500">📞 CLOSED-SHOP CONTACT NUMBER</span>
              <input value={shopForm.closedContactNumber} onChange={(e) => { setShopForm({ ...shopForm, closedContactNumber: e.target.value }); setShopSaved(false); }} inputMode="tel"
                className="mt-1 w-full max-w-md rounded-xl border-2 border-stone-200 px-3 py-2.5 font-bold outline-none focus:border-orange-500 bg-[#F6F9FF]" placeholder="0300-0000000" />
              <span className="block text-xs text-stone-400 mt-1">Band wale popup mein ye number bara bara nazar ayega — 📞 Call aur 💬 WhatsApp button ke sath. Number badal kar neeche <b>Save Settings</b> lazmi dabayein.</span>
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <label className="block">
              <span className="text-xs font-extrabold text-stone-500">COLLEGE NAME</span>
              <input value={shopForm.collegeName} onChange={(e) => { setShopForm({ ...shopForm, collegeName: e.target.value }); setShopSaved(false); }}
                className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 font-bold outline-none focus:border-orange-500 bg-[#F6F9FF]" placeholder="e.g. ABC College" />
            </label>
            <label className="block">
              <span className="text-xs font-extrabold text-stone-500">CANTEEN NAME</span>
              <input value={shopForm.canteenName} onChange={(e) => { setShopForm({ ...shopForm, canteenName: e.target.value }); setShopSaved(false); }}
                className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 font-bold outline-none focus:border-orange-500 bg-[#F6F9FF]" placeholder="College Canteen" />
            </label>
            <label className="block">
              <span className="text-xs font-extrabold text-stone-500">GROCERY STORE NAME</span>
              <input value={shopForm.groceryName} onChange={(e) => { setShopForm({ ...shopForm, groceryName: e.target.value }); setShopSaved(false); }}
                className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 font-bold outline-none focus:border-orange-500 bg-[#F6F9FF]" placeholder="Campus Grocery Store" />
            </label>
          </div>
          <div className="mt-4 pt-3 border-t border-dashed border-stone-200">
            <div className="font-extrabold mb-1">💳 Online Payment Numbers <span className="text-xs font-bold text-stone-400">(online orders ke liye)</span></div>
            <p className="text-sm text-stone-500 mb-3">Online customer pehle in mein se kisi number par payment karke <b>proof (screenshot)</b> upload karta hai — phir aapko upar wale <b>Payment Verification</b> panel se tasdeeq karni hoti hai, tab order confirm hota hai. Yeh demo numbers hain — apne asal JazzCash / Easypaisa / Raast numbers yahan set karein.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <label className="block">
                <span className="text-xs font-extrabold text-stone-500">JAZZCASH NUMBER</span>
                <input value={shopForm.jazzcashNumber} onChange={(e) => { setShopForm({ ...shopForm, jazzcashNumber: e.target.value }); setShopSaved(false); }}
                  className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 font-bold outline-none focus:border-orange-500 bg-[#F6F9FF]" placeholder="03XX-XXXXXXX" />
              </label>
              <label className="block">
                <span className="text-xs font-extrabold text-stone-500">EASYPAISA NUMBER</span>
                <input value={shopForm.easypaisaNumber} onChange={(e) => { setShopForm({ ...shopForm, easypaisaNumber: e.target.value }); setShopSaved(false); }}
                  className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 font-bold outline-none focus:border-orange-500 bg-[#F6F9FF]" placeholder="03XX-XXXXXXX" />
              </label>
              <label className="block">
                <span className="text-xs font-extrabold text-stone-500">RAAST / BANK (IBAN)</span>
                <input value={shopForm.raastInfo} onChange={(e) => { setShopForm({ ...shopForm, raastInfo: e.target.value }); setShopSaved(false); }}
                  className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 font-bold outline-none focus:border-orange-500 bg-[#F6F9FF]" placeholder="Raast ID / IBAN" />
              </label>
            </div>
          </div>
          <MerchantQrSection
            shopTitle={shopForm.collegeName || shopForm.canteenName}
            numbers={{ jazzcash: shopForm.jazzcashNumber, easypaisa: shopForm.easypaisaNumber, raast: shopForm.raastInfo }}
          />
          <div className="mt-4 pt-3 border-t border-dashed border-stone-200">
            <div className="font-extrabold mb-1">📦 Wholesale Minimum Quantity <span className="text-xs font-bold text-stone-400">(shop defaults)</span></div>
            <p className="text-sm text-stone-500 mb-3">Wholesale bill mein har line ko kam az kam itni quantity chahiye — warna bill complete nahi hota (server bhi refuse karta hai). Kisi product/packing ki apni minimum set ho to wohi lagegi; ye sirf defaults hain.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs font-extrabold text-stone-500">MINIMUM PIECES (default)</span>
                <input type="number" min={0} value={shopForm.wholesaleMinPieces} onChange={(e) => { setShopForm({ ...shopForm, wholesaleMinPieces: parseFloat(e.target.value) || 0 }); setShopSaved(false); }}
                  className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 font-bold outline-none focus:border-orange-500 bg-[#F6F9FF]" />
              </label>
              <label className="block">
                <span className="text-xs font-extrabold text-stone-500">MINIMUM KG (default, per-kg items)</span>
                <input type="number" min={0} step="0.5" value={shopForm.wholesaleMinKg} onChange={(e) => { setShopForm({ ...shopForm, wholesaleMinKg: parseFloat(e.target.value) || 0 }); setShopSaved(false); }}
                  className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 font-bold outline-none focus:border-orange-500 bg-[#F6F9FF]" />
              </label>
            </div>
          </div>
          {/* 🏪 Business Setup — dukaan ki qisam (SALE version) */}
          <div className="mt-4 pt-3 border-t border-dashed border-stone-200" data-testid="business-setup-block">
            <div className="font-extrabold mb-1">🏪 Business Setup — Aapka Business Konsa Hai</div>
            <p className="text-sm text-stone-500 mb-2">
              Maujooda setup: <b data-testid="business-setup-current">{businessSummary}</b>. Setup badalne se system ka view usi hisaab se ho jata hai —
              jo dukaan off ho us ke tabs/sections chhup jate hain. <b>Koi data delete nahi hota</b> — purani dukaan ka data mehfooz rehta hai, wapas on karne par sab waisa hi milta hai.
              Template ka demo samaan sirf tab seed hota hai jab grocery data kabhi save na hua ho (server rule).
            </p>
            <Link href="/setup" data-testid="business-setup-change" className="inline-block rounded-xl px-5 py-2.5 font-extrabold text-white" style={{ background: "#0F172A" }}>🔁 Tabdeel karein</Link>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button onClick={() => { saveShop({ ...loadShop(), collegeName: shopForm.collegeName.trim(), canteenName: shopForm.canteenName.trim() || "College Canteen", groceryName: shopForm.groceryName.trim() || "Campus Grocery Store", jazzcashNumber: shopForm.jazzcashNumber.trim() || SHOP_DEFAULTS.jazzcashNumber, easypaisaNumber: shopForm.easypaisaNumber.trim() || SHOP_DEFAULTS.easypaisaNumber, raastInfo: shopForm.raastInfo.trim() || SHOP_DEFAULTS.raastInfo, wholesaleMinPieces: shopForm.wholesaleMinPieces, wholesaleMinKg: shopForm.wholesaleMinKg, closedContactNumber: shopForm.closedContactNumber.trim() || SHOP_DEFAULTS.closedContactNumber, shopOpen: shopForm.shopOpen, tableCount: shopForm.tableCount }); setShopSaved(true); }}
              className="rounded-xl px-5 py-2.5 font-extrabold text-white" style={{ background: "#16A34A" }}>💾 Save Settings</button>
            {shopSaved && <span className="font-bold" style={{ color: "#16A34A" }}>✓ Saved — names + payment numbers updated everywhere.</span>}
          </div>
        </section>
        )}

        {ownerTab === "tables" && (
        <section className="bg-white rounded-2xl border border-orange-100 shadow-sm p-4">
          <div className="flex justify-end mb-2">
            <GuidelineButton entry="owner-tables" />
          </div>
          <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
            <h2 className="font-extrabold">🪑 Tables &amp; QR — Print &amp; Stick on Tables</h2>
            <button onClick={() => { document.body.classList.add("print-tables"); window.print(); setTimeout(() => document.body.classList.remove("print-tables"), 500); }}
              className="rounded-xl px-4 py-2 font-extrabold text-white no-print" style={{ background: "#0F172A" }}>🖨️ Print Table Cards</button>
          </div>
          <p className="text-sm text-stone-500 mb-3">Every table has its OWN QR. The customer scans it → {shop.canteenName} ordering opens with that table already filled (they can change it). A general canteen QR (no table) can also be printed from the Online Order link: <b>{origin}/online</b></p>
          {/* Table count — kitni tables hain (1..100). Cards + online flow isi count se chalte hain. */}
          <div className="flex flex-wrap items-end gap-2 mb-4 rounded-2xl border-2 border-orange-100 bg-[#FFFBF5] p-3 no-print">
            <label className="block">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Tables ki tadaad (1–100)</span>
              <span className="flex items-center gap-1.5">
                <button onClick={() => setTcDraft(String(Math.max(1, (parseInt(tcDraft, 10) || 8) - 1)))} className="rounded-xl w-11 h-11 font-black text-xl bg-white border-2 border-stone-200" aria-label="Tables kam karein">−</button>
                <input value={tcDraft} onChange={(e) => setTcDraft(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" aria-label="Table count"
                  className="w-20 rounded-xl border-2 border-stone-200 px-3 py-2.5 text-center font-black text-lg outline-none focus:border-orange-500 bg-white" />
                <button onClick={() => setTcDraft(String(Math.min(100, (parseInt(tcDraft, 10) || 8) + 1)))} className="rounded-xl w-11 h-11 font-black text-xl bg-white border-2 border-stone-200" aria-label="Tables barhayein">+</button>
              </span>
            </label>
            <button onClick={() => applyTableCount(parseInt(tcDraft, 10))} className="rounded-xl px-5 py-2.5 font-extrabold text-white" style={{ background: "#16A34A" }}>✔ Apply</button>
            {tcSaved && <span className="font-bold pb-2" style={{ color: "#16A34A" }}>✓ Saved — ab {shop.tableCount} tables active hain.</span>}
            <span className="text-xs text-stone-400 pb-2">Count kam karne se purane bills/orders ki table history NAHI badalti — sirf naye orders ke liye tables 1–{shop.tableCount} valid rehti hain.</span>
          </div>
          <div id="table-qr-sheet" className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: shop.tableCount ?? 8 }, (_, i) => i + 1).map((n) => (
              <div key={n} className="rounded-2xl border-2 border-dashed border-stone-300 bg-[#FFFBF5] p-4 text-center">
                <div className="text-xs font-bold text-stone-400">{shop.collegeName || shop.canteenName}</div>
                <div className="text-3xl font-black" style={{ color: "#F97316" }}>TABLE {n}</div>
                <div className="flex justify-center my-2 bg-white p-2 rounded-xl shadow-sm w-fit mx-auto">
                  <QRCode value={`${origin}/online?table=${n}`} size={110} />
                </div>
                <div className="font-black text-sm">📱 Scan to Order — {shop.canteenName}</div>
                <div className="text-[10px] text-stone-400 break-all">{origin}/online?table={n}</div>
              </div>
            ))}
          </div>
        </section>
        )}
      </main>

      {/* Bill reprint view — same line-split receipt as the original bill */}
      {viewOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 overflow-y-auto p-4">
          <div className="max-w-md mx-auto py-4 pop-in">
            <Receipt order={viewOrder} />
            <div className="flex gap-2 mt-4 no-print">
              <button onClick={() => window.print()} className="flex-1 rounded-2xl py-3.5 font-black bg-white text-stone-900 shadow">🖨️ Reprint (80mm)</button>
              <button onClick={() => setViewOrder(null)} className="flex-1 rounded-2xl py-3.5 font-black text-white shadow" style={{ background: "#DC2626" }}>✕ Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Staff side — role-gated: only staff whose tabs include Owner Dashboard
// (the owner, or someone the owner ticked) can open this page. The old
// standalone PIN gate is gone — the owner PIN is now the staff login PIN.
export default function OwnerPage() {
  return (
    <StaffGate tab="owner">
      <OwnerScreen />
    </StaffGate>
  );
}
