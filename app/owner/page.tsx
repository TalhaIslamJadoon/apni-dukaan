"use client";

import { useEffect, useMemo, useState } from "react";
import TopBar from "@/components/TopBar";
import StaffGate from "@/components/StaffGate";
import OrderAlerts from "@/components/OrderAlerts";
import Receipt from "@/components/Receipt";
import { GuidelineButton, GuidelineIndexButton } from "@/components/Guideline";
import QRCode from "react-qr-code";
import Barcode128 from "@/components/Barcode128";
import {
  CATEGORIES, Category, GroceryHead, GroceryItem, GrocerySubHead, MenuItem, Order, StaffMember, TabKey, TABS_META,
  loadMenu, saveMenu, loadOrders, saveOrders, isToday, nextToken, adjustStockForOrder, loadGrocery, saveGrocery, loadGroceryHeads, saveGroceryHeads, loadGrocerySubHeads, saveGrocerySubHeads, billNoOf,
  loadShop, saveShop, useShop, ShopSettings, SHOP_DEFAULTS, loadStaff, saveStaff,
  ProofPaymentMethod, merchantNumber, QR_FIELD_OF, TITLE_FIELD_OF,
  UdhaarWasooli, WasooliMethod, WASOOLI_METHODS, loadUdhaarWasooli, saveUdhaarWasooli, udhaarCustomerOf, useStaffSession,
} from "@/lib/store";

// Emoji choices for a NEW grocery head (owner picks one from this row).
const HEAD_EMOJIS = ["🌾", "🫙", "☕", "🥛", "🍪", "🧼", "🧴", "🥐", "🧊", "🏠", "🥤", "🍫", "👶", "🥜", "🌶️", "🛒"];
// Pastel tints handed out to owner-added heads (same family as the seeds).
const HEAD_TINTS = ["#FFFBEB", "#EFF6FF", "#F0FDF4", "#FDF2F8", "#F5F3FF", "#FFF7ED", "#ECFEFF", "#FEF2F2"];
// URL-ish slug for owner-created head / sub-head ids.
const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";

// Merchant QR upload: downscale to max 512px and keep PNG (JPEG blur QR
// ki lines kharab kar deta hai — scan mushkil ho jata hai). Data URL
// ShopSettings mein save hoti hai, bilkul proof screenshots ki tarah.
function compressQrImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const max = 512;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const c2d = canvas.getContext("2d");
        if (!c2d) { URL.revokeObjectURL(url); reject(new Error("no canvas")); return; }
        c2d.fillStyle = "#ffffff"; c2d.fillRect(0, 0, canvas.width, canvas.height);
        c2d.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/png"));
      } catch (e) { URL.revokeObjectURL(url); reject(e instanceof Error ? e : new Error("compress failed")); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image load failed")); };
    img.src = url;
  });
}

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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-extrabold mb-1">🔐 Staff Access — Kis Ko Konsa Tab Milega</h2>
          <p className="text-sm text-stone-500 mb-3">Har banday ko <b>sirf usi ke tabs</b> nazar aayenge jo yahan tick hain. Ek banday ko kai tabs bhi de sakte hain (masalan Canteen + Grocery). Naam + PIN se woh login karega.</p>
        </div>
        <GuidelineButton entry="owner-staff" />
      </div>
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
    const token = nextToken(all); // token is assigned at CONFIRMATION time, not placement
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

// ── Udhaar Khata — customer credit accounts + WASOOLI (repayments) ─────────
// Talha's missing screen: charges come from the BILLS themselves (every
// order with payment "Udhaar") — customers are keyed by name+ID exactly as
// stored on the charges (store.udhaarCustomerOf; no new identity model).
// Wasooli entries are recorded HERE against the open account and persisted
// in their own list (store.loadUdhaarWasooli) with entered-by = the
// logged-in staff member. Rules: amount must be > 0 and must NOT exceed the
// current baqaya. Every balance shown is DERIVED: charges − wasooli.
// Billing itself is untouched — recording wasooli never edits an order.
interface UdhaarAccount {
  key: string;
  name: string;
  id?: string;
  charges: Order[];
  payments: UdhaarWasooli[];
  totalUdhaar: number;
  totalWasool: number;
  baqaya: number;
}

function UdhaarKhataSection({ orders }: { orders: Order[] }) {
  const me = useStaffSession();
  const [wasooli, setWasooli] = useState<UdhaarWasooli[]>([]);
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<WasooliMethod>("Cash");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const read = () => setWasooli(loadUdhaarWasooli());
    read();
    window.addEventListener("udhaar-wasooli-changed", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("udhaar-wasooli-changed", read);
      window.removeEventListener("storage", read);
    };
  }, []);

  const accounts = useMemo<UdhaarAccount[]>(() => {
    const map = new Map<string, UdhaarAccount>();
    const ensure = (key: string, name: string, id?: string) => {
      let a = map.get(key);
      if (!a) { a = { key, name, id, charges: [], payments: [], totalUdhaar: 0, totalWasool: 0, baqaya: 0 }; map.set(key, a); }
      return a;
    };
    for (const o of orders) {
      if (o.payment !== "Udhaar") continue;
      const c = udhaarCustomerOf(o);
      const a = ensure(c.key, c.name, c.id);
      a.charges.push(o);
      a.totalUdhaar += o.total;
    }
    for (const w of wasooli) {
      const a = ensure(w.customerKey, w.customerName, w.customerId);
      a.payments.push(w);
      a.totalWasool += w.amount;
    }
    const list = [...map.values()];
    for (const a of list) {
      a.charges.sort((x, y) => x.createdAt.localeCompare(y.createdAt));
      a.payments.sort((x, y) => x.at.localeCompare(y.at));
      a.baqaya = a.totalUdhaar - a.totalWasool;
    }
    // Sab se zyada baqaya pehle — khata book ki tarteeb.
    return list.sort((a, b) => b.baqaya - a.baqaya || a.name.localeCompare(b.name));
  }, [orders, wasooli]);

  const totals = useMemo(() => ({
    udhaar: accounts.reduce((s, a) => s + a.totalUdhaar, 0),
    wasool: accounts.reduce((s, a) => s + a.totalWasool, 0),
    baqaya: accounts.reduce((s, a) => s + a.baqaya, 0),
  }), [accounts]);

  const q = search.trim().toLowerCase();
  const visible = accounts.filter((a) => !q || a.name.toLowerCase().includes(q) || (a.id ?? "").toLowerCase().includes(q));
  const selected = accounts.find((a) => a.key === selectedKey) ?? null;

  // Ledger — charges + wasooli merged, oldest first, running balance.
  const ledger = useMemo(() => {
    if (!selected) return [] as { at: string; kind: "charge" | "wasooli"; label: string; detail: string; amount: number; balance: number }[];
    const rows = [
      ...selected.charges.map((o) => ({
        at: o.createdAt, kind: "charge" as const,
        label: `📒 Udhaar — ${billNoOf(o)}`,
        detail: `${o.mode === "grocery" ? "🛒 Grocery" : "🍽️ Canteen"}${o.source === "online" ? " · 🌐 Online" : ""}${o.cashier ? ` · Cashier: ${o.cashier}` : ""}`,
        amount: o.total, balance: 0,
      })),
      ...selected.payments.map((w) => ({
        at: w.at, kind: "wasooli" as const,
        label: `💰 Wasooli — ${w.method}`,
        detail: `${w.note ? `${w.note} · ` : ""}Darj kiya: ${w.by}`,
        amount: -w.amount, balance: 0,
      })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    let bal = 0;
    for (const r of rows) { bal += r.amount; r.balance = bal; }
    return rows;
  }, [selected]);

  function pick(a: UdhaarAccount) {
    setSelectedKey(a.key === selectedKey ? null : a.key);
    setMsg(""); setAmount(""); setNote(""); setMethod("Cash");
  }

  function recordWasooli() {
    if (!selected) return;
    const amt = parseInt(amount, 10);
    if (isNaN(amt) || amt <= 0) { setMsg("⚠️ Wasooli ki raqam sahi likhein — Rs 0 se zyada honi chahiye"); return; }
    if (amt > selected.baqaya) {
      setMsg(`⛔ Wasooli Rs ${amt.toLocaleString()} hai lekin ${selected.name} ka baqaya sirf Rs ${selected.baqaya.toLocaleString()} hai — baqaya se zyada wasooli darj nahi ho sakti`);
      return;
    }
    const entry: UdhaarWasooli = {
      id: `wasooli-${Date.now()}`,
      customerKey: selected.key,
      customerName: selected.name,
      customerId: selected.id,
      amount: amt,
      method,
      note: note.trim() || undefined,
      by: me?.name ?? "Owner",
      at: new Date().toISOString(),
    };
    const next = [entry, ...loadUdhaarWasooli()];
    saveUdhaarWasooli(next);
    setWasooli(next);
    setAmount(""); setNote("");
    setMsg(`✓ Rs ${amt.toLocaleString()} wasooli darj ho gayi (${method}) — ${selected.name} ka naya baqaya Rs ${(selected.baqaya - amt).toLocaleString()} hai`);
  }

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString()} · ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  };

  return (
    <section className="bg-white rounded-2xl border border-orange-100 shadow-sm p-4" data-testid="udhaar-khata">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-extrabold mb-1">💰 Udhaar Khata — Baqaya aur Wasooli</h2>
          <p className="text-sm text-stone-500 mb-3">Jis customer ne <b>Udhaar</b> par bill banaya, us ka khata yahan khud banta hai — <b>naam + ID jaisa bill par likha tha</b>. Baqaya hamesha <b>Kul Udhaar − Kul Wasooli</b> se banta hai. Ye <b>all-time</b> hisaab hai (Overview wala Udhaar card sirf aaj ka hai).</p>
        </div>
        <GuidelineButton entry="owner-udhaar" />
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3 text-center">
          <div className="text-xs font-black text-stone-500">📒 KUL UDHAAR</div>
          <div className="text-xl font-black" style={{ color: "#F59E0B" }} data-testid="udhaar-total-udhaar">Rs {totals.udhaar.toLocaleString()}</div>
        </div>
        <div className="rounded-2xl border border-green-200 bg-green-50/60 p-3 text-center">
          <div className="text-xs font-black text-stone-500">💰 KUL WASOOLI</div>
          <div className="text-xl font-black" style={{ color: "#16A34A" }} data-testid="udhaar-total-wasool">Rs {totals.wasool.toLocaleString()}</div>
        </div>
        <div className="rounded-2xl border border-red-200 bg-red-50/60 p-3 text-center">
          <div className="text-xs font-black text-stone-500">🧮 KUL BAQAYA</div>
          <div className="text-xl font-black" style={{ color: "#DC2626" }} data-testid="udhaar-total-baqaya">Rs {totals.baqaya.toLocaleString()}</div>
        </div>
      </div>

      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 Customer ka naam ya ID likhein…"
        data-testid="udhaar-search"
        className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 mb-3 outline-none focus:border-orange-500" />

      {accounts.length === 0 && (
        <p className="font-bold text-stone-400">Abhi kisi customer ka udhaar khata nahi hai — pehla Udhaar bill bante hi khata yahan khud aa jayega.</p>
      )}
      {accounts.length > 0 && visible.length === 0 && (
        <p className="font-bold text-stone-400">Is naam / ID ka koi khata nahi mila.</p>
      )}

      <div className="space-y-1.5 mb-4">
        {visible.map((a) => (
          <button key={a.key} onClick={() => pick(a)} data-testid="udhaar-account-row" data-key={a.key}
            className={`w-full flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border-2 px-3 py-2.5 text-left transition ${selectedKey === a.key ? "border-orange-500 bg-orange-50" : "border-orange-100 bg-orange-50/40 hover:bg-orange-50"}`}>
            <span className="font-extrabold">👤 {a.name}</span>
            {a.id && <span className="text-[10px] font-black rounded-full px-2 py-0.5 text-white" style={{ background: "#0F172A" }}>ID: {a.id}</span>}
            <span className="text-xs font-bold text-stone-400">{a.charges.length} udhaar bill{a.charges.length === 1 ? "" : "s"}</span>
            <span className="ml-auto flex items-center gap-3 text-sm">
              <span className="font-bold text-stone-500">Udhaar <b style={{ color: "#F59E0B" }}>Rs {a.totalUdhaar.toLocaleString()}</b></span>
              <span className="font-bold text-stone-500">Wasooli <b style={{ color: "#16A34A" }}>Rs {a.totalWasool.toLocaleString()}</b></span>
              {a.baqaya > 0
                ? <span className="font-black rounded-full px-2.5 py-1 text-white text-xs" style={{ background: "#DC2626" }}>Baqaya Rs {a.baqaya.toLocaleString()}</span>
                : <span className="font-black rounded-full px-2.5 py-1 text-white text-xs" style={{ background: "#16A34A" }}>✅ Clear</span>}
            </span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/40 p-3 pop-in" data-testid="udhaar-ledger">
          <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
            <div>
              <div className="font-black text-lg">👤 {selected.name}{selected.id ? <span className="ml-2 text-[11px] font-black rounded-full px-2 py-0.5 text-white align-middle" style={{ background: "#0F172A" }}>ID: {selected.id}</span> : null}</div>
              <div className="text-sm font-bold text-stone-500">
                Udhaar <b style={{ color: "#F59E0B" }}>Rs {selected.totalUdhaar.toLocaleString()}</b> · Wasooli <b style={{ color: "#16A34A" }}>Rs {selected.totalWasool.toLocaleString()}</b> · Baqaya <b style={{ color: selected.baqaya > 0 ? "#DC2626" : "#16A34A" }} data-testid="udhaar-selected-baqaya">Rs {selected.baqaya.toLocaleString()}</b>
              </div>
            </div>
            <button onClick={() => setSelectedKey(null)} className="rounded-lg px-3 py-1.5 font-bold bg-white border border-stone-200 text-sm">✕ Band Karein</button>
          </div>

          {selected.baqaya > 0 ? (
            <div className="rounded-2xl bg-white border border-amber-200 p-3 mb-2">
              <div className="font-extrabold mb-2">💰 Wasooli Darj Karein</div>
              <div className="flex flex-wrap gap-2 items-end">
                <label className="block w-36">
                  <span className="block text-xs font-extrabold text-stone-500">AMOUNT (RS)</span>
                  <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} placeholder="e.g. 500" inputMode="numeric"
                    data-testid="wasooli-amount"
                    className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-green-600" />
                </label>
                <label className="block w-40">
                  <span className="block text-xs font-extrabold text-stone-500">METHOD</span>
                  <select value={method} onChange={(e) => setMethod(e.target.value as WasooliMethod)}
                    data-testid="wasooli-method"
                    className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none bg-white">
                    {WASOOLI_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
                <label className="block flex-1 min-w-[180px]">
                  <span className="block text-xs font-extrabold text-stone-500">NOTE (OPTIONAL)</span>
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. aadhi raqam mili"
                    data-testid="wasooli-note"
                    className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-green-600" />
                </label>
                <button onClick={recordWasooli} data-testid="wasooli-save"
                  className="rounded-xl px-5 py-2.5 font-extrabold text-white active:scale-[0.99]" style={{ background: "#16A34A" }}>
                  💰 Wasooli Darj Karein
                </button>
              </div>
            </div>
          ) : (
            <p className="font-black mb-2" style={{ color: "#16A34A" }}>✅ Is customer ka khata clear hai — koi baqaya nahi.</p>
          )}
          {msg && (
            <p className="font-bold text-sm mb-2" data-testid="wasooli-msg" style={{ color: msg.startsWith("✓") ? "#16A34A" : "#DC2626" }}>{msg}</p>
          )}

          <div className="rounded-xl border border-amber-100 bg-white overflow-x-auto">
            <table className="w-full text-sm min-w-[620px] border-collapse">
              <thead>
                <tr className="bg-[#FFF7ED] text-left text-[11px] uppercase tracking-wide text-stone-500">
                  <th className="font-extrabold px-3 py-2 w-44">Date</th>
                  <th className="font-extrabold px-2 py-2">Entry</th>
                  <th className="font-extrabold px-2 py-2">Tafseel</th>
                  <th className="font-extrabold px-2 py-2 w-28 text-right">Raqam</th>
                  <th className="font-extrabold px-3 py-2 w-28 text-right">Baqaya</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((r, i) => (
                  <tr key={i} className={`h-10 border-t border-orange-100/70 ${i % 2 ? "bg-orange-50/40" : "bg-white"}`}>
                    <td className="px-3 py-1.5 whitespace-nowrap text-stone-500 font-semibold">{fmtDate(r.at)}</td>
                    <td className="px-2 py-1.5 font-bold whitespace-nowrap">{r.label}</td>
                    <td className="px-2 py-1.5 text-stone-500">{r.detail}</td>
                    <td className="px-2 py-1.5 text-right font-black whitespace-nowrap" style={{ color: r.kind === "charge" ? "#F59E0B" : "#16A34A" }}>
                      {r.kind === "charge" ? "+" : "−"} Rs {Math.abs(r.amount).toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5 text-right font-black whitespace-nowrap">Rs {r.balance.toLocaleString()}</td>
                  </tr>
                ))}
                {ledger.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-4 text-center font-bold text-stone-400">Khata khali hai.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function OwnerScreen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [form, setForm] = useState({ name: "", price: "", category: "Snacks" as Category, emoji: "🍽️" });
  const [editId, setEditId] = useState<string | null>(null);
  const [viewOrder, setViewOrder] = useState<Order | null>(null);
  const [origin, setOrigin] = useState("http://localhost:3007");
  useEffect(() => { try { setOrigin(window.location.origin); } catch {} }, []);
  const shop = useShop();
  const [shopForm, setShopForm] = useState<ShopSettings>(SHOP_DEFAULTS);
  const [shopInit, setShopInit] = useState(false);
  const [shopSaved, setShopSaved] = useState(false);
  const [tableCountSaved, setTableCountSaved] = useState(false);
  useEffect(() => {
    if (!shopInit) { setShopForm(loadShop()); setShopInit(true); }
  }, [shopInit]);
  // Merchant QR (Settings): upload/remove FORAN save hota hai (Shop Status
  // switch wali tarah) aur shopForm mein mirror bhi, taake baad wala
  // Save Settings click QR ko wapas purana na kar de. Titles aam text
  // fields hain — woh Save Settings se save hote hain.
  const [qrStand, setQrStand] = useState<ProofPaymentMethod | null>(null);
  async function onQrFile(m: ProofPaymentMethod, e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const url = await compressQrImage(f);
      const field = QR_FIELD_OF[m];
      saveShop({ ...loadShop(), [field]: url });
      setShopForm((fm) => ({ ...fm, [field]: url }));
    } catch { /* unreadable image — owner dobara try karega */ }
  }
  function removeQr(m: ProofPaymentMethod) {
    const field = QR_FIELD_OF[m];
    saveShop({ ...loadShop(), [field]: "" });
    setShopForm((fm) => ({ ...fm, [field]: "" }));
    setQrStand((s) => (s === m ? null : s));
  }
  function printQrStand(m: ProofPaymentMethod) {
    setQrStand(m);
    // Stand pehle render hone dein, phir print — table cards wale body
    // class pattern par (globals.css: body.print-qrstand).
    setTimeout(() => {
      document.body.classList.add("print-qrstand");
      window.print();
      setTimeout(() => document.body.classList.remove("print-qrstand"), 500);
    }, 400);
  }
  const [grocery, setGrocery] = useState<GroceryItem[]>([]);
  const [gForm, setGForm] = useState({ name: "", sku: "", barcode: "", retail: "", wholesale: "", wholesaleMinQty: "", stock: "", unit: "piece" as "piece" | "kg", emoji: "🛒", headId: "", subId: "", image: "" });
  const [gPackings, setGPackings] = useState<{ label: string; retail: string; wholesale: string }[]>([]);
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
  // Heads manager — which heads are expanded (sub-heads collapsed by default
  // so 20 heads fit as compact one-line rows). Presentation only.
  const [openHeads, setOpenHeads] = useState<Record<string, boolean>>({});
  // Owner Dashboard section tabs — only the selected section renders, so the
  // page is one section tall instead of one endless scroll. Presentation only.
  const [ownerTab, setOwnerTab] = useState("overview");
  // Barcode label printing state — selection (id → sticker copies), filters,
  // and the open print sheet (product + copies entries).
  const [labelSel, setLabelSel] = useState<Record<string, number>>({});
  const [labelHead, setLabelHead] = useState("all");
  const [labelSub, setLabelSub] = useState("all");
  const [labelSearch, setLabelSearch] = useState("");
  const [sheet, setSheet] = useState<{ item: GroceryItem; copies: number }[] | null>(null);
  // Grocery products LIST controls — compact table: search / head / sub-head
  // filters + pagination (50 per page). List windowing only; the product
  // form and all handlers (editG / delG / label sheet) are unchanged.
  const [gListSearch, setGListSearch] = useState("");
  const [gListHead, setGListHead] = useState("all");
  const [gListSub, setGListSub] = useState("all");
  const [gListPage, setGListPage] = useState(1);

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
  const lowStockCount =
    menu.filter((m) => (m.stock ?? 0) <= (m.lowStock ?? 5)).length +
    grocery.filter((g) => g.stock <= (g.lowStock ?? (g.unit === "kg" ? 2 : 5))).length;

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
    let next: MenuItem[];
    if (editId) {
      next = menu.map((m) => (m.id === editId ? { ...m, name: form.name.trim(), price, category: form.category, emoji: form.emoji || "🍽️" } : m));
    } else {
      next = [...menu, { id: `item-${Date.now()}`, name: form.name.trim(), price, category: form.category, emoji: form.emoji || "🍽️" }];
    }
    setMenu(next); saveMenu(next);
    setForm({ name: "", price: "", category: "Snacks", emoji: "🍽️" }); setEditId(null);
  }
  function del(id: string) { const next = menu.filter((m) => m.id !== id); setMenu(next); saveMenu(next); }
  function edit(m: MenuItem) { setEditId(m.id); setForm({ name: m.name, price: String(m.price), category: m.category, emoji: m.emoji }); }

  const subsOfHead = (hid: string) => subs.filter((s) => s.headId === hid);
  function saveGItem() {
    const retail = parseInt(gForm.retail, 10); const wholesale = parseInt(gForm.wholesale, 10) || retail;
    const wholesaleMinQty = gForm.wholesaleMinQty.trim() === "" ? undefined : parseFloat(gForm.wholesaleMinQty);
    const stock = parseFloat(gForm.stock);
    if (!gForm.name.trim() || !gForm.sku.trim() || isNaN(retail) || retail <= 0 || isNaN(stock) || (wholesaleMinQty !== undefined && (isNaN(wholesaleMinQty) || wholesaleMinQty < 0))) return;
    let next: GroceryItem[];
    // Head + Sub-Head: the form's choice — fall back to the first head / its
    // first sub-head if the chosen ones were deleted while the form was open
    // (never save a product outside the 3-level structure). A head with NO
    // sub-heads cannot take products yet — add a sub-head first (manager).
    const headId = heads.some((h) => h.id === gForm.headId) ? gForm.headId : (heads[0]?.id ?? "");
    const subId = subsOfHead(headId).some((s) => s.id === gForm.subId) ? gForm.subId : (subsOfHead(headId)[0]?.id ?? "");
    if (!headId || !subId) { setHeadMsg("⚠️ Product save nahi hua — pehle is head ke andar ek Sub-Head add karein (neeche Heads manager mein)."); return; }
    // Packings: only complete rows (label + retail price) are kept.
    const packings = gPackings
      .filter((p) => p.label.trim() && parseInt(p.retail, 10) > 0)
      .map((p) => ({ label: p.label.trim(), retailPrice: parseInt(p.retail, 10), wholesalePrice: parseInt(p.wholesale, 10) || parseInt(p.retail, 10) }));
    const base = { name: gForm.name.trim(), sku: gForm.sku.trim(), barcode: gForm.barcode.trim() || undefined, retailPrice: retail, wholesalePrice: wholesale, wholesaleMinQty, stock, unit: gForm.unit, emoji: gForm.emoji || "🛒", headId, subId, image: gForm.image.trim() || undefined, packings: packings.length ? packings : undefined };
    if (gEditId) next = grocery.map((g) => (g.id === gEditId ? { ...g, ...base } : g));
    else next = [...grocery, { id: `g-${Date.now()}`, ...base }];
    setGrocery(next); saveGrocery(next);
    setGForm({ name: "", sku: "", barcode: "", retail: "", wholesale: "", wholesaleMinQty: "", stock: "", unit: "piece", emoji: "🛒", headId, subId, image: "" }); setGPackings([]); setGEditId(null);
  }
  function delG(id: string) { const next = grocery.filter((g) => g.id !== id); setGrocery(next); saveGrocery(next); }
  function editG(g: GroceryItem) {
    setGEditId(g.id);
    setGForm({ name: g.name, sku: g.sku, barcode: g.barcode ?? "", retail: String(g.retailPrice), wholesale: String(g.wholesalePrice), wholesaleMinQty: g.wholesaleMinQty !== undefined ? String(g.wholesaleMinQty) : "", stock: String(g.stock), unit: g.unit, emoji: g.emoji, headId: g.headId, subId: g.subId, image: g.image ?? "" });
    setGPackings((g.packings ?? []).map((p) => ({ label: p.label, retail: String(p.retailPrice), wholesale: String(p.wholesalePrice) })));
  }
  function resetGForm() {
    setGEditId(null); setGPackings([]);
    setGForm({ name: "", sku: "", barcode: "", retail: "", wholesale: "", wholesaleMinQty: "", stock: "", unit: "piece", emoji: "🛒", headId: heads[0]?.id ?? "", subId: subs.find((s) => s.headId === heads[0]?.id)?.id ?? "", image: "" });
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
  function addSub() {
    const name = subName.trim();
    const hid = heads.some((h) => h.id === subHeadSel) ? subHeadSel : (heads[0]?.id ?? "");
    if (!name) { setHeadMsg("⚠️ Sub-head ka naam likhein"); return; }
    if (!hid) { setHeadMsg("⚠️ Pehle ek Head add karein — sub-head head ke andar banta hai"); return; }
    const base = `${hid}:${slugify(name)}`;
    const id = subs.some((s) => s.id === base) ? `${base}-${Date.now()}` : base;
    const ns: GrocerySubHead = { id, headId: hid, name };
    if (subImage.trim()) ns.image = subImage.trim();
    const next = [...subs, ns];
    setSubs(next); saveGrocerySubHeads(next);
    setSubName(""); setSubImage("");
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

  // ── Grocery products list — filtered + paged for the compact table ──
  // Search matches name / SKU / barcode; head + sub-head filters narrow it
  // further. Changing any filter resets to page 1 (handlers below).
  const G_PAGE_SIZE = 50;
  const gFiltered = grocery.filter((g) => {
    const q = gListSearch.trim().toLowerCase();
    if (q && !(g.name.toLowerCase().includes(q) || g.sku.toLowerCase().includes(q) || (g.barcode ?? "").toLowerCase().includes(q))) return false;
    if (gListHead !== "all" && g.headId !== gListHead) return false;
    if (gListSub !== "all" && g.subId !== gListSub) return false;
    return true;
  });
  const gTotalPages = Math.max(1, Math.ceil(gFiltered.length / G_PAGE_SIZE));
  const gPageSafe = Math.min(gListPage, gTotalPages);
  const gPageItems = gFiltered.slice((gPageSafe - 1) * G_PAGE_SIZE, gPageSafe * G_PAGE_SIZE);

  // Pending online-payment verifications — shown as a badge on the Overview tab.
  const pendingVerify = orders.filter((o) => o.paymentStatus === "proof_pending").length;

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
        {/* Owner section tabs — sticky sub-nav; only the selected section renders */}
        <div className="sticky top-2 z-30 bg-white rounded-2xl border border-orange-100 shadow-md p-2 flex gap-1.5 overflow-x-auto" data-testid="owner-tabs">
          {([
            { id: "overview", label: "📊 Overview" },
            { id: "udhaar", label: "💰 Udhaar Khata" },
            { id: "menu", label: "🍽️ Canteen Menu" },
            { id: "grocery", label: "🛒 Grocery" },
            { id: "heads", label: "🗂️ Heads" },
            { id: "labels", label: "🏷️ Labels" },
            { id: "staff", label: "🔐 Staff" },
            { id: "settings", label: "⚙️ Settings" },
            { id: "tables", label: "🪑 Tables QR" },
          ] as const).map((t) => (
            <button key={t.id} onClick={() => setOwnerTab(t.id)} data-testid={`owner-tab-${t.id}`}
              className={`whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-extrabold transition ${ownerTab === t.id ? "text-white shadow" : "bg-orange-50 text-stone-600 hover:bg-orange-100"}`}
              style={ownerTab === t.id ? { background: "#F97316" } : undefined}>
              {t.label}
              {t.id === "overview" && pendingVerify > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full text-[11px] font-black text-white align-middle" style={{ background: "#DC2626" }}>{pendingVerify}</span>
              )}
            </button>
          ))}
        </div>
        {ownerTab === "overview" && (<>
        <div className="flex justify-end">
          <GuidelineButton entry="owner-overview" />
        </div>
        <div className="bg-white rounded-2xl border border-orange-100 shadow-sm p-4 flex flex-wrap gap-x-8 gap-y-1 items-center">
          <span className="font-extrabold">📊 Today — {new Date().toLocaleDateString()}</span>
          <span>🍽️ Canteen Sales: <b style={{ color: "#F97316" }}>Rs {canteenSales.toLocaleString()}</b></span>
          <span>🛒 Grocery Sales: <b style={{ color: "#16A34A" }}>Rs {grocerySales.toLocaleString()}</b></span>
          <span>Combined: <b>Rs {totalSales.toLocaleString()}</b></span>
          <span>🏪 Counter: <b>Rs {counterSales.toLocaleString()}</b></span>
          <span>📦 Low Stock: <b style={{ color: lowStockCount > 0 ? "#DC2626" : "#16A34A" }}>{lowStockCount} items</b> <span className="text-stone-400">(Stock tab mein tafseel)</span></span>
          <span>📱 Online Orders: <b style={{ color: "#1976D2" }}>Rs {onlineOrderSales.toLocaleString()}</b> ({onlineOrders.length}) — 🍔 Online-Canteen <b>Rs {onlineCanteenSales.toLocaleString()}</b> · 🛒 Online-Grocery <b>Rs {onlineGrocerySales.toLocaleString()}</b></span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {cards.map((c) => (
            <div key={c.label} className="kpi-3d bg-white rounded-2xl border border-orange-100 shadow-md p-4">
              <div className="flex justify-between items-center"><span className="text-xs font-bold text-stone-500">{c.label}</span><span className="inline-flex items-center justify-center w-9 h-9 rounded-full text-lg shadow-sm" style={{ background: c.color + "22" }}>{c.icon}</span></div>
              <div className="text-2xl font-black mt-1" style={{ color: c.color }}><AnimNum value={c.num} prefix={c.prefix} /></div>
            </div>
          ))}
        </div>

        </>)}

        {ownerTab === "staff" && <StaffAccessSection />}

        {ownerTab === "udhaar" && <UdhaarKhataSection orders={orders} />}

        {ownerTab === "overview" && (<>
        <PaymentVerificationSection orders={orders} onDone={() => setOrders(loadOrders())} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <section className="min-w-0 bg-white rounded-2xl border border-orange-100 shadow-sm p-4">
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
        </>)}

        {ownerTab === "menu" && (
        <section className="bg-white rounded-2xl border border-orange-100 shadow-sm p-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-extrabold mb-1">🍽️ Menu Management</h2>
            <GuidelineButton entry="owner-menu" />
          </div>
          <p className="text-sm mb-3 font-bold" style={{ color: "#F59E0B" }}>⚠️ Current menu is a SAMPLE — replace with Talha&apos;s real menu &amp; prices.</p>
          <div className="flex flex-wrap gap-2 mb-4 items-end">
            <label className="block flex-1 min-w-[160px]">
              <span className="block text-xs font-extrabold text-stone-500">ITEM NAME</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Item name" className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500" />
            </label>
            <label className="block w-28">
              <span className="block text-xs font-extrabold text-stone-500">PRICE RS</span>
              <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="Price Rs" inputMode="numeric" className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500" />
            </label>
            <label className="block w-16">
              <span className="block text-xs font-extrabold text-stone-500">EMOJI</span>
              <input value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} placeholder="🍔" className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 text-center outline-none focus:border-orange-500" />
            </label>
            <label className="block">
              <span className="block text-xs font-extrabold text-stone-500">CATEGORY</span>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Category })} className="mt-1 rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none">
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <button onClick={saveItem} className="rounded-xl px-5 py-2.5 font-extrabold text-white" style={{ background: "#16A34A" }}>{editId ? "Save Edit" : "+ Add Item"}</button>
            {editId && <button onClick={() => { setEditId(null); setForm({ name: "", price: "", category: "Snacks", emoji: "🍽️" }); }} className="rounded-xl px-4 py-2.5 font-bold bg-stone-100">Cancel</button>}
          </div>
          <div className="rounded-xl border border-orange-100 overflow-x-auto" data-testid="canteen-menu-table">
            <table className="w-full text-sm min-w-[560px] border-collapse">
              <thead>
                <tr className="bg-[#FFF7ED] text-left text-[11px] uppercase tracking-wide text-stone-500">
                  <th className="font-extrabold px-3 py-2">Item</th>
                  <th className="font-extrabold px-2 py-2 w-28">Category</th>
                  <th className="font-extrabold px-2 py-2 w-24">Price</th>
                  <th className="font-extrabold px-2 py-2 w-28">Stock</th>
                  <th className="font-extrabold px-3 py-2 w-32 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {menu.map((m, i) => (
                  <tr key={m.id} className={`h-11 border-t border-orange-100/70 hover:bg-orange-50 ${i % 2 ? "bg-orange-50/40" : "bg-white"}`}>
                    <td className="px-3 py-1.5">
                      <span className="flex items-center gap-2 min-w-0">
                        {m.image
                          ? <img src={m.image} alt="" className="w-7 h-7 rounded-md object-cover shrink-0" />
                          : <span className="w-7 h-7 rounded-md bg-[#FFF7ED] border border-orange-100 flex items-center justify-center text-base shrink-0">{m.emoji}</span>}
                        <span className="font-bold truncate" title={m.name}>{m.name}</span>
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-stone-500 whitespace-nowrap">{m.category}</td>
                    <td className="px-2 py-1.5 font-bold whitespace-nowrap">Rs {m.price}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {m.stock !== undefined
                        ? <span style={{ color: m.stock <= (m.lowStock ?? 5) ? "#DC2626" : undefined }} className="font-bold">{m.stock} pcs{m.stock <= (m.lowStock ?? 5) ? " · Low" : ""}</span>
                        : <span className="text-stone-400">—</span>}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-right">
                      <button onClick={() => edit(m)} className="font-bold text-xs px-2.5 py-1.5 rounded-lg bg-white border border-stone-200">Edit</button>
                      <button onClick={() => del(m.id)} className="font-bold text-xs px-2.5 py-1.5 rounded-lg text-white ml-1.5" style={{ background: "#DC2626" }}>✕</button>
                    </td>
                  </tr>
                ))}
                {menu.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-4 text-center font-bold text-stone-400">Menu khali hai — upar se item add karein.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        )}

        {(ownerTab === "grocery" || ownerTab === "heads" || ownerTab === "labels") && (
        <section className="bg-white rounded-2xl border border-orange-100 shadow-sm p-4">
          {ownerTab === "grocery" && (<>
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-extrabold mb-1">🛒 Grocery Products Management</h2>
            <GuidelineButton entry="owner-grocery" />
          </div>
          <p className="text-sm mb-3 font-bold" style={{ color: "#F59E0B" }}>⚠️ Current products are SAMPLE — replace with the real grocery list, SKUs &amp; prices.</p>
          <div className="flex flex-wrap gap-2 mb-4 items-end">
            <label className="block flex-1 min-w-[150px]">
              <span className="block text-xs font-extrabold text-stone-500">PRODUCT NAME</span>
              <input value={gForm.name} onChange={(e) => setGForm({ ...gForm, name: e.target.value })} placeholder="Product name" className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500" />
            </label>
            <label className="block w-28">
              <span className="block text-xs font-extrabold text-stone-500">SKU</span>
              <input value={gForm.sku} onChange={(e) => setGForm({ ...gForm, sku: e.target.value })} placeholder="SKU/PLU" className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500" />
            </label>
            <label className="block w-44">
              <span className="block text-xs font-extrabold text-stone-500">EAN BARCODE</span>
              <input value={gForm.barcode} onChange={(e) => setGForm({ ...gForm, barcode: e.target.value })} placeholder="🏷️ EAN Barcode (packed items)" className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500" />
            </label>
            <label className="block w-24">
              <span className="block text-xs font-extrabold text-stone-500">RETAIL PRICE RS</span>
              <input value={gForm.retail} onChange={(e) => setGForm({ ...gForm, retail: e.target.value })} placeholder="Retail Rs" inputMode="numeric" className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500" />
            </label>
            <label className="block w-28">
              <span className="block text-xs font-extrabold text-stone-500">WHOLESALE PRICE RS</span>
              <input value={gForm.wholesale} onChange={(e) => setGForm({ ...gForm, wholesale: e.target.value })} placeholder="Wholesale Rs" inputMode="numeric" className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500" />
            </label>
            <label className="block w-44">
              <span className="block text-xs font-extrabold text-stone-500">WHOLESALE MIN QTY</span>
              <input value={gForm.wholesaleMinQty} onChange={(e) => setGForm({ ...gForm, wholesaleMinQty: e.target.value })} placeholder="Wholesale Min Qty" title="Blank = shop default" inputMode="decimal" aria-label="Wholesale Min Qty" data-testid="wholesale-min-qty-input" className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500" />
            </label>
            <label className="block w-20">
              <span className="block text-xs font-extrabold text-stone-500">STOCK QTY</span>
              <input value={gForm.stock} onChange={(e) => setGForm({ ...gForm, stock: e.target.value })} placeholder="Stock" inputMode="decimal" className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500" />
            </label>
            <label className="block">
              <span className="block text-xs font-extrabold text-stone-500">UNIT</span>
              <select value={gForm.unit} onChange={(e) => setGForm({ ...gForm, unit: e.target.value as "piece" | "kg" })} className="mt-1 rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none">
                <option value="piece">per piece</option>
                <option value="kg">per kg</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-extrabold text-stone-500">MAIN HEAD</span>
              <select value={gForm.headId} onChange={(e) => { const hid = e.target.value; setGForm({ ...gForm, headId: hid, subId: subs.find((s) => s.headId === hid)?.id ?? "" }); }} className="mt-1 rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500 font-bold" aria-label="Head">
                {heads.map((h) => <option key={h.id} value={h.id}>{h.emoji} {h.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-extrabold text-stone-500">SUB-HEAD</span>
              <select value={gForm.subId} onChange={(e) => setGForm({ ...gForm, subId: e.target.value })} className="mt-1 rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500 font-bold" aria-label="Sub-Head" disabled={subsOfHead(gForm.headId).length === 0}>
                {subsOfHead(gForm.headId).length
                  ? subsOfHead(gForm.headId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)
                  : <option value="">— pehle is head mein sub-head add karein —</option>}
              </select>
            </label>
            <label className="block w-14">
              <span className="block text-xs font-extrabold text-stone-500">EMOJI</span>
              <input value={gForm.emoji} onChange={(e) => setGForm({ ...gForm, emoji: e.target.value })} className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 text-center outline-none focus:border-orange-500" />
            </label>
            <label className="block flex-1 min-w-[220px]">
              <span className="block text-xs font-extrabold text-stone-500">IMAGE URL</span>
              <input value={gForm.image} onChange={(e) => setGForm({ ...gForm, image: e.target.value })} placeholder="🖼️ Image URL (optional — na ho to sub-head/head ki picture lagegi)" className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500" aria-label="Product image URL" />
            </label>
            <button onClick={saveGItem} className="rounded-xl px-5 py-2.5 font-extrabold text-white" style={{ background: "#16A34A" }}>{gEditId ? "Save Edit" : "+ Add Product"}</button>
            {gEditId && <button onClick={resetGForm} className="rounded-xl px-4 py-2.5 font-bold bg-stone-100">Cancel</button>}
            {/* Packings editor — sizes of THIS product (not separate items) */}
            <div className="w-full rounded-2xl border-2 border-dashed border-stone-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <span className="font-extrabold text-sm">📦 Packings (sizes) — optional</span>
                <button onClick={() => setGPackings((p) => [...p, { label: "", retail: "", wholesale: "" }])} className="rounded-lg px-3 py-1.5 text-white text-sm font-bold" style={{ background: "#16A34A" }}>+ Packing</button>
              </div>
              <p className="text-xs text-stone-500 mb-2">Size alag item NAHI hota — packing isi product ki hoti hai (e.g. Surf Excel: 500g / 1kg / 2kg). Khali chhor dein to product base price par bikega.</p>
              {gPackings.map((p, i) => (
                <div key={i} className="flex flex-wrap gap-2 mb-2 items-end">
                  <label className="block w-36">
                    <span className="block text-xs font-extrabold text-stone-500">PACKING SIZE</span>
                    <input placeholder="Label (e.g. 1kg)" className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2" value={p.label} onChange={(e) => setGPackings((rows) => rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))} />
                  </label>
                  <label className="block w-28">
                    <span className="block text-xs font-extrabold text-stone-500">RETAIL PRICE RS</span>
                    <input placeholder="Retail Rs" inputMode="numeric" className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2" value={p.retail} onChange={(e) => setGPackings((rows) => rows.map((r, j) => (j === i ? { ...r, retail: e.target.value } : r)))} />
                  </label>
                  <label className="block w-32">
                    <span className="block text-xs font-extrabold text-stone-500">WHOLESALE PRICE RS</span>
                    <input placeholder="Wholesale Rs" inputMode="numeric" className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2" value={p.wholesale} onChange={(e) => setGPackings((rows) => rows.map((r, j) => (j === i ? { ...r, wholesale: e.target.value } : r)))} />
                  </label>
                  <button onClick={() => setGPackings((rows) => rows.filter((_, j) => j !== i))} className="rounded-lg px-3 py-2 font-bold text-white" style={{ background: "#DC2626" }} aria-label="Remove packing">✕</button>
                </div>
              ))}
            </div>
          </div>
          </>)}
          {/* Grocery Heads manager — structure: Main Head → Sub Head → Product */}
          {ownerTab === "heads" && (
          <div className="rounded-2xl border-2 border-dashed border-stone-200 p-3 mb-4" data-testid="heads-manager">
            <div className="flex items-start justify-between gap-2">
              <div className="font-extrabold mb-1">🗂️ Grocery Heads — apna head khud banayein</div>
              <GuidelineButton entry="owner-heads" />
            </div>
            <p className="text-xs text-stone-500 mb-2">Structure: <b>Main Head → Sub Head → Product</b> — head / sub-head tab delete hoga jab us mein <b>0 products</b> hon; pehle products shift karein. Head kholne ke liye ▶ dabayein.</p>
            <div className="space-y-1.5 mb-3">
              {heads.map((h) => (
                <div key={h.id} className="rounded-xl border border-stone-100 px-2.5 py-1" style={{ background: h.tint }}>
                  <div className="flex flex-wrap items-center gap-2 min-h-[40px]">
                    <button onClick={() => setOpenHeads((o) => ({ ...o, [h.id]: !o[h.id] }))} aria-label={openHeads[h.id] ? `Collapse ${h.name}` : `Expand ${h.name}`} data-testid={`head-toggle-${h.id}`}
                      className="w-6 h-6 shrink-0 rounded-md bg-white/80 border border-stone-200 text-[11px] font-black leading-none">{openHeads[h.id] ? "▼" : "▶"}</button>
                    <span className="text-lg">{h.emoji}</span>
                    {headEditId === h.id ? (
                      <>
                        <input value={headEditName} onChange={(e) => setHeadEditName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") renameHead(); }}
                          className="rounded-lg border-2 border-stone-200 px-2.5 py-1.5 font-bold flex-1 min-w-[140px] outline-none focus:border-orange-500 bg-white" autoFocus />
                        <input value={headEditImg} onChange={(e) => setHeadEditImg(e.target.value)} placeholder="🖼️ Image URL (optional)"
                          className="rounded-lg border-2 border-stone-200 px-2.5 py-1.5 flex-1 min-w-[140px] outline-none focus:border-orange-500 bg-white" aria-label="Head image URL" />
                        <button onClick={renameHead} className="font-bold text-sm px-3 py-1.5 rounded-lg text-white" style={{ background: "#16A34A" }}>Save</button>
                        <button onClick={() => setHeadEditId(null)} className="font-bold text-sm px-3 py-1.5 rounded-lg bg-white border border-stone-200">Cancel</button>
                      </>
                    ) : (
                      <>
                        <span className="font-extrabold text-sm whitespace-nowrap">{h.name}</span>
                        <span className="text-[11px] font-extrabold px-1.5 py-0.5 rounded-full bg-white/80 border border-stone-200 text-stone-600 whitespace-nowrap">{headCount(h.id)} products</span>
                        <span className="text-xs text-stone-500 truncate min-w-0" title={subsOfHead(h.id).map((s) => `${s.name} · ${subCount(s.id)}`).join(" | ")}>
                          {subsOfHead(h.id).length ? subsOfHead(h.id).map((s) => `${s.name} · ${subCount(s.id)}`).join("  |  ") : "koi sub-head nahi"}
                        </span>
                        <span className="ml-auto flex gap-1.5 shrink-0">
                          <button onClick={() => { setHeadEditId(h.id); setHeadEditName(h.name); setHeadEditImg(h.image ?? ""); setHeadMsg(""); }} className="font-bold text-xs px-2.5 py-1 rounded-lg bg-white border border-stone-200">Rename</button>
                          <button onClick={() => deleteHead(h)} className="font-bold text-xs px-2.5 py-1 rounded-lg text-white" style={{ background: "#DC2626" }}>Delete</button>
                        </span>
                      </>
                    )}
                  </div>
                  {openHeads[h.id] && (
                  <div className="ml-7 mt-1 mb-0.5 rounded-lg bg-white/60 border border-stone-100 px-2 py-1.5 space-y-1">
                    {subsOfHead(h.id).map((s) => (
                      <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white/80 border border-stone-100 px-2 py-1">
                        {subEditId === s.id ? (
                          <>
                            <input value={subEditName} onChange={(e) => setSubEditName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") renameSub(); }}
                              className="rounded-lg border-2 border-stone-200 px-2.5 py-1 font-bold flex-1 min-w-[120px] outline-none focus:border-orange-500 bg-white" autoFocus />
                            <input value={subEditImg} onChange={(e) => setSubEditImg(e.target.value)} placeholder="🖼️ Image URL (optional)"
                              className="rounded-lg border-2 border-stone-200 px-2.5 py-1 flex-1 min-w-[120px] outline-none focus:border-orange-500 bg-white" aria-label="Sub-head image URL" />
                            <button onClick={renameSub} className="font-bold text-xs px-2.5 py-1.5 rounded-lg text-white" style={{ background: "#16A34A" }}>Save</button>
                            <button onClick={() => setSubEditId(null)} className="font-bold text-xs px-2.5 py-1.5 rounded-lg bg-white border border-stone-200">Cancel</button>
                          </>
                        ) : (
                          <>
                            <span className="font-bold text-[13px]">↳ {s.name}</span>
                            <span className="text-[11px] font-extrabold px-1.5 py-0.5 rounded-full bg-orange-50 border border-orange-100 text-stone-600 whitespace-nowrap">{subCount(s.id)} products</span>
                            <span className="ml-auto flex gap-1.5 shrink-0">
                              <button onClick={() => { setSubEditId(s.id); setSubEditName(s.name); setSubEditImg(s.image ?? ""); setHeadMsg(""); }} className="font-bold text-xs px-2.5 py-1 rounded-lg bg-white border border-stone-200">Rename</button>
                              <button onClick={() => deleteSub(s)} className="font-bold text-xs px-2.5 py-1 rounded-lg text-white" style={{ background: "#DC2626" }}>Delete</button>
                            </span>
                          </>
                        )}
                      </div>
                    ))}
                    {subsOfHead(h.id).length === 0 && <div className="text-xs font-bold text-stone-400 pl-1">Koi sub-head nahi — neeche se add karein, tabhi is head mein product aayega</div>}
                    <button onClick={() => { setSubHeadSel(h.id); setHeadMsg(""); const el = document.querySelector<HTMLInputElement>('[data-testid="add-sub-name"]'); el?.scrollIntoView({ block: "center", behavior: "smooth" }); el?.focus({ preventScroll: true }); }}
                      className="font-bold text-xs px-2.5 py-1 rounded-lg text-white" style={{ background: "#0F172A" }}>+ Add Sub-Head</button>
                  </div>
                  )}
                </div>
              ))}
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
              <input value={subName} onChange={(e) => setSubName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addSub(); }} placeholder="Naye sub-head ka naam (e.g. Powder)" data-testid="add-sub-name" className="rounded-xl border-2 border-stone-200 px-3 py-2.5 flex-1 min-w-[190px] outline-none focus:border-orange-500" />
              <input value={subImage} onChange={(e) => setSubImage(e.target.value)} placeholder="🖼️ Sub-Head Image URL (optional)" className="rounded-xl border-2 border-stone-200 px-3 py-2.5 flex-1 min-w-[170px] outline-none focus:border-orange-500" aria-label="New sub-head image URL" />
              <button onClick={addSub} className="rounded-xl px-4 py-2.5 font-extrabold text-white" style={{ background: "#0F172A" }}>+ Add Sub-Head</button>
            </div>
            {headMsg && <p className="mt-2 text-sm font-bold" style={{ color: headMsg.startsWith("✓") ? "#16A34A" : "#DC2626" }}>{headMsg}</p>}
          </div>
          )}
          {/* Grocery products — compact TABLE (one row per product) + filters + pagination */}
          {ownerTab === "grocery" && (<>
          <div className="flex flex-wrap items-center gap-2 mb-2" data-testid="grocery-list-controls">
            <input value={gListSearch} onChange={(e) => { setGListSearch(e.target.value); setGListPage(1); }} placeholder="🔍 Product / SKU / Barcode search…" aria-label="Grocery products search"
              className="rounded-xl border-2 border-stone-200 px-3 py-2 flex-1 min-w-[190px] outline-none focus:border-orange-500" />
            <select value={gListHead} onChange={(e) => { setGListHead(e.target.value); setGListSub("all"); setGListPage(1); }} aria-label="Products head filter"
              className="rounded-xl border-2 border-stone-200 px-3 py-2 font-bold outline-none focus:border-orange-500">
              <option value="all">Saare Heads</option>
              {heads.map((h) => <option key={h.id} value={h.id}>{h.emoji} {h.name}</option>)}
            </select>
            <select value={gListSub} onChange={(e) => { setGListSub(e.target.value); setGListPage(1); }} aria-label="Products sub-head filter" disabled={gListHead === "all"}
              className="rounded-xl border-2 border-stone-200 px-3 py-2 font-bold outline-none focus:border-orange-500 disabled:opacity-50">
              <option value="all">{gListHead === "all" ? "Pehle Head chunein" : "Saare Sub-Heads"}</option>
              {gListHead !== "all" && subsOfHead(gListHead).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <span className="text-sm font-bold text-stone-500" data-testid="grocery-list-count">{grocery.length} mein se {gFiltered.length} products</span>
          </div>
          <div className="rounded-xl border border-orange-100 overflow-x-auto" data-testid="grocery-products-table">
            <table className="w-full text-sm min-w-[880px] border-collapse">
              <thead>
                <tr className="bg-[#FFF7ED] text-left text-[11px] uppercase tracking-wide text-stone-500">
                  <th className="font-extrabold px-3 py-2">Product</th>
                  <th className="font-extrabold px-2 py-2 w-24">SKU</th>
                  <th className="font-extrabold px-2 py-2 w-20">Retail</th>
                  <th className="font-extrabold px-2 py-2 w-20">WS</th>
                  <th className="font-extrabold px-2 py-2 w-24">Stock</th>
                  <th className="font-extrabold px-2 py-2 w-52">Head › Sub</th>
                  <th className="font-extrabold px-2 py-2 w-20">Packings</th>
                  <th className="font-extrabold px-3 py-2 w-44 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {gPageItems.map((g, i) => {
                  const hd = heads.find((h) => h.id === g.headId);
                  const sb = subs.find((s) => s.id === g.subId);
                  const lowLimit = g.lowStock ?? (g.unit === "kg" ? 2 : 5);
                  return (
                    <tr key={g.id} data-testid="grocery-product-row" className={`h-11 border-t border-orange-100/70 hover:bg-orange-50 ${i % 2 ? "bg-orange-50/40" : "bg-white"}`}>
                      <td className="px-3 py-1.5 max-w-[260px]">
                        <span className="flex items-center gap-2 min-w-0">
                          {g.image
                            ? <img src={g.image} alt="" className="w-7 h-7 rounded-md object-cover shrink-0" />
                            : <span className="w-7 h-7 rounded-md bg-[#FFF7ED] border border-orange-100 flex items-center justify-center text-base shrink-0">{g.emoji}</span>}
                          <span className="font-bold truncate" title={g.name}>{g.name}</span>
                        </span>
                      </td>
                      <td className="px-2 py-1.5 font-mono text-xs text-stone-500 whitespace-nowrap">{g.sku}</td>
                      <td className="px-2 py-1.5 font-bold whitespace-nowrap">Rs {g.retailPrice}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">Rs {g.wholesalePrice}{g.wholesaleMinQty !== undefined ? <span className="block text-[10px] font-bold text-stone-400">min {g.wholesaleMinQty}</span> : null}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <span className="font-bold" style={{ color: g.stock <= 0 ? "#DC2626" : g.stock <= lowLimit ? "#D97706" : undefined }}>{g.stock} {g.unit}</span>
                        {g.stock <= 0 && <span className="block text-[10px] font-black" style={{ color: "#DC2626" }}>KHATAM</span>}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-stone-500 max-w-[210px]">
                        <span className="block truncate" title={`${hd?.name ?? ""} › ${sb?.name ?? ""}`}>{hd ? `${hd.emoji} ${hd.name}` : "—"}{sb ? ` › ${sb.name}` : ""}</span>
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{g.packings?.length ? `📦 ${g.packings.length}` : <span className="text-stone-400">—</span>}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-right">
                        <button onClick={() => setSheet([{ item: g, copies: 1 }])} className="font-bold text-xs px-2.5 py-1.5 rounded-lg bg-white border border-stone-200">🏷️ Label</button>
                        <button onClick={() => editG(g)} className="font-bold text-xs px-2.5 py-1.5 rounded-lg bg-white border border-stone-200 ml-1.5">Edit</button>
                        <button onClick={() => delG(g.id)} className="font-bold text-xs px-2.5 py-1.5 rounded-lg text-white ml-1.5" style={{ background: "#DC2626" }}>✕</button>
                      </td>
                    </tr>
                  );
                })}
                {gPageItems.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-5 text-center font-bold text-stone-400">Is search / filter mein koi product nahi mila.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-2" data-testid="grocery-pagination">
            <button onClick={() => setGListPage(gPageSafe - 1)} disabled={gPageSafe <= 1}
              className="rounded-xl px-4 py-2 font-extrabold border-2 border-stone-200 bg-white disabled:opacity-40">← Prev</button>
            <span className="text-sm font-bold">Page {gPageSafe} of {gTotalPages}</span>
            <button onClick={() => setGListPage(gPageSafe + 1)} disabled={gPageSafe >= gTotalPages}
              className="rounded-xl px-4 py-2 font-extrabold border-2 border-stone-200 bg-white disabled:opacity-40">Next →</button>
            <span className="text-xs font-bold text-stone-400">Har page par {G_PAGE_SIZE} products — baqi pages par hain, page ab lamba nahi hota</span>
          </div>
          </>)}
          {/* Barcode Labels — bulk sticker printing (label printer) */}
          {ownerTab === "labels" && (
          <div className="rounded-2xl border-2 border-dashed border-stone-200 p-3 mt-4" data-testid="label-panel">
            <div className="flex items-start justify-between gap-2">
              <div className="font-extrabold mb-1">🏷️ Barcode Labels — stickers print karein</div>
              <GuidelineButton entry="owner-labels" />
            </div>
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
            <div className="max-h-[260px] overflow-y-auto space-y-1 mb-2 pr-1" data-testid="label-picker-scroll">
              {labelVisible.map((g) => {
                const on = labelSel[g.id] !== undefined;
                return (
                  <label key={g.id} className="flex items-center gap-2 rounded-lg bg-orange-50/60 border border-orange-100 px-2.5 py-1.5 cursor-pointer">
                    <input type="checkbox" checked={on} onChange={(e) => toggleLabel(g.id, e.target.checked)} className="w-4 h-4 shrink-0" />
                    <span className="text-lg">{g.emoji}</span>
                    <span className="flex-1 min-w-0">
                      <span className="font-bold text-sm block truncate">{g.name}</span>
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
        </section>
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
          <div className="flex justify-end mb-3">
            <GuidelineButton entry="owner-settings" />
          </div>
          {/* Shop Status — manual open/close switch. Saves IMMEDIATELY (does
              not wait for "Save Settings") so BAND karte hi online page band
              ho jati hai; the saved value is also mirrored into shopForm so
              a later Save Settings click can never revert it. When BAND,
              /online (remote + table-QR) shows the closed popup below. */}
          <div className="mb-4 rounded-2xl border-2 p-3" style={{ borderColor: shopForm.shopOpen ? "#16A34A" : "#DC2626", background: shopForm.shopOpen ? "#F0FDF4" : "#FEF2F2" }}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="font-extrabold text-lg">{shopForm.shopOpen ? "🟢 Shop KHULI hai" : "🔴 Shop BAND hai"}</div>
                <div className="text-sm text-stone-500">{shopForm.shopOpen ? "Online customers order kar sakte hain." : "Online page par BAND wala popup aa raha hai — order nahi ho raha, sirf neeche wala number Call/WhatsApp ke sath dikh raha hai."}</div>
              </div>
              <button data-testid="shop-open-toggle" onClick={() => { const cur = loadShop(); const next = { ...cur, shopOpen: !cur.shopOpen }; saveShop(next); setShopForm((f) => ({ ...f, shopOpen: next.shopOpen })); }}
                className="rounded-xl px-5 py-3 font-extrabold text-white" style={{ background: shopForm.shopOpen ? "#DC2626" : "#16A34A" }}>
                {shopForm.shopOpen ? "🔴 Shop BAND kar dein" : "🟢 Shop KHOL dein"}
              </button>
            </div>
          </div>
          <div className="mb-4">
            <div className="font-extrabold mb-1">📞 Closed-Shop Contact Number</div>
            <p className="text-sm text-stone-500 mb-2">Jab shop <b>BAND</b> ho, online customers ko popup mein ye number bara sa dikhega — <b>📞 Call</b> aur <b>💬 WhatsApp</b> button ke sath, taake wo phone par order kar saken. Apna asal number yahan likh kar neeche <b>Save Settings</b> dabayein (status wala switch upar foran save ho jata hai, ye number Save Settings se save hota hai).</p>
            <label className="block max-w-sm">
              <span className="text-xs font-extrabold text-stone-500">CONTACT NUMBER (BAND HONE PAR)</span>
              <input data-testid="closed-contact-input" value={shopForm.closedContactNumber} onChange={(e) => { setShopForm({ ...shopForm, closedContactNumber: e.target.value }); setShopSaved(false); }}
                className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 font-bold outline-none focus:border-orange-500 bg-[#F6F9FF]" placeholder="03XX-XXXXXXX" inputMode="tel" />
            </label>
          </div>
          <div className="pt-3 border-t border-dashed border-stone-200">
          <h2 className="font-extrabold mb-1">🏷️ Shop Settings — Names</h2>
          <p className="text-sm text-stone-500 mb-3">Set the real names here — they update <b>everywhere</b>: top header, bill headers, table QR cards and the Online Order page. No code editing needed.</p>
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
          {/* Merchant QR codes — Talha apne har account ka ASAL QR yahan
              upload karega (payment app → My QR / Receive Money wali
              picture). QR lagte hi online payment step par customer ko
              wahi QR bara nazar ata hai (scan-and-pay); proof upload +
              Owner tasdeeq ka gate bilkul waisa hi rehta hai. QR upload/
              remove FORAN save hota hai; Account Title Save Settings se. */}
          <div className="mt-4 pt-3 border-t border-dashed border-stone-200">
            <div className="font-extrabold mb-1">📷 Payment QR Codes <span className="text-xs font-bold text-stone-400">(scan-and-pay ke liye)</span></div>
            <p className="text-sm text-stone-500 mb-3">Har method ka <b>asal QR</b> upload karein — online customer ko payment wale step par yahi QR bara dikhega. QR na lagaya ho to customer ko sirf number dikhta hai. <b>Farzi/demo QR kabhi na lagayein</b> — sirf apne account ka asal QR. QR Stand print karke counter par lagayein taake walk-in customer bhi scan karke pay kar sake.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {(["JazzCash", "Easypaisa", "Raast", "Bank"] as ProofPaymentMethod[]).map((m) => {
                const qr = shopForm[QR_FIELD_OF[m]];
                const slug = m.toLowerCase();
                return (
                  <div key={m} className="rounded-2xl border-2 border-stone-200 p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="font-extrabold">{m}</span>
                      {qr
                        ? <span className="text-[10px] font-black rounded-full px-2 py-0.5 text-white" style={{ background: "#16A34A" }}>✓ QR LAGA HAI</span>
                        : <span className="text-[10px] font-black rounded-full px-2 py-0.5 bg-stone-100 text-stone-500">QR NAHI LAGAYA</span>}
                    </div>
                    <div className="flex gap-3">
                      {qr
                        ? <img src={qr} alt={`${m} QR code`} data-testid={`qr-preview-${slug}`} className="w-28 h-28 object-contain rounded-xl border border-stone-200 bg-white shrink-0" />
                        : <div className="w-28 h-28 rounded-xl border-2 border-dashed border-stone-200 bg-stone-50 flex items-center justify-center text-center text-[11px] font-bold text-stone-400 shrink-0 px-1">QR ki picture yahan ayegi</div>}
                      <div className="flex-1 min-w-0">
                        <label className="block mb-2">
                          <span className="text-xs font-extrabold text-stone-500">ACCOUNT TITLE (QR STAND PAR)</span>
                          <input value={shopForm[TITLE_FIELD_OF[m]]} onChange={(e) => { setShopForm({ ...shopForm, [TITLE_FIELD_OF[m]]: e.target.value }); setShopSaved(false); }}
                            className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2 font-bold outline-none focus:border-orange-500 bg-[#F6F9FF]" placeholder="e.g. Talha Islam" data-testid={`qr-title-${slug}`} />
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          <label className="rounded-xl px-3 py-2 font-extrabold text-white cursor-pointer" style={{ background: "#F97316" }}>
                            {qr ? "🔁 QR Badlein" : "📷 QR Upload Karein"}
                            <input type="file" accept="image/*" className="hidden" data-testid={`qr-upload-${slug}`} onChange={(e) => onQrFile(m, e)} />
                          </label>
                          {qr && <button onClick={() => removeQr(m)} data-testid={`qr-remove-${slug}`} className="rounded-xl px-3 py-2 font-extrabold bg-white border-2 border-red-200" style={{ color: "#DC2626" }}>🗑️ Remove</button>}
                          {qr && <button onClick={() => printQrStand(m)} data-testid={`qr-stand-${slug}`} className="rounded-xl px-3 py-2 font-extrabold text-white" style={{ background: "#0F172A" }}>🖨️ QR Stand</button>}
                        </div>
                        <p className="text-[11px] font-bold text-stone-400 mt-1.5">Number: <span className="break-all">{merchantNumber(shopForm, m)}</span>{m === "Bank" && " (RAAST / BANK wala hi number)"}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* QR Stand — counter par lagane wala card. Screen par preview,
                print mein sirf yahi card (globals.css body.print-qrstand). */}
            {qrStand && shopForm[QR_FIELD_OF[qrStand]] && (
              <div className="mt-4">
                {/* Stand A5 par chhapta hai — bill wale 80mm @page ko is
                    card ke liye override (label sheet wali hi technique). */}
                <style>{`@media print { @page { size: A5 portrait; margin: 6mm; } }`}</style>
                <div className="flex justify-center">
                  <div id="qr-stand-area" className="rounded-2xl p-5 text-center bg-white shadow-sm" style={{ border: "4px solid #0F172A", width: "148mm", maxWidth: "100%" }}>
                    <div className="font-black text-2xl leading-tight">{shopForm.canteenName}</div>
                    <div className="font-extrabold text-stone-500">{shopForm.groceryName}</div>
                    {shopForm.collegeName.trim() && <div className="text-xs font-bold text-stone-400 mt-0.5">{shopForm.collegeName}</div>}
                    <div className="mt-3 inline-block rounded-full px-4 py-1.5 font-black text-white text-lg" style={{ background: "#16A34A" }}>{qrStand} — Payment QR</div>
                    <img src={shopForm[QR_FIELD_OF[qrStand]]} alt={`${qrStand} QR stand`} className="w-64 h-64 object-contain mx-auto my-3 bg-white" />
                    {shopForm[TITLE_FIELD_OF[qrStand]].trim() && <div className="font-extrabold text-lg">{shopForm[TITLE_FIELD_OF[qrStand]]}</div>}
                    <div className="font-black text-xl break-all">{merchantNumber(shopForm, qrStand)}</div>
                    <div className="font-black text-xl mt-3">📷 Scan karke payment karein</div>
                    <div className="text-xs font-bold text-stone-500 mt-1">Online order mein payment ke baad screenshot (proof) upload karna lazmi hai.</div>
                  </div>
                </div>
                <div className="text-center mt-2 no-print">
                  <button onClick={() => setQrStand(null)} className="text-xs font-extrabold rounded-lg bg-white border border-stone-200 px-3 py-1.5">✕ Stand Preview Band Karein</button>
                </div>
              </div>
            )}
          </div>
          <div className="mt-4 pt-3 border-t border-dashed border-stone-200">
            <div className="font-extrabold mb-1">📦 Wholesale Minimums <span className="text-xs font-bold text-stone-400">(per bill line)</span></div>
            <p className="text-sm text-stone-500 mb-3">Wholesale bill ki har line ko kam az kam itni quantity leni hogi. Kisi khaas product ki limit alag rakhni ho to Grocery Products form mein us product ka <b>Wholesale Min Qty</b> set karein — woh in defaults par override karega.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs font-extrabold text-stone-500">Wholesale Min (pieces)</span>
                <input type="number" min="0" step="1" value={shopForm.wholesaleMinPieces} onChange={(e) => { setShopForm({ ...shopForm, wholesaleMinPieces: e.target.value === "" ? 0 : Number(e.target.value) }); setShopSaved(false); }}
                  className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 font-bold outline-none focus:border-orange-500 bg-[#F6F9FF]" data-testid="wholesale-min-pieces-input" />
              </label>
              <label className="block">
                <span className="text-xs font-extrabold text-stone-500">Wholesale Min (kg)</span>
                <input type="number" min="0" step="0.5" value={shopForm.wholesaleMinKg} onChange={(e) => { setShopForm({ ...shopForm, wholesaleMinKg: e.target.value === "" ? 0 : Number(e.target.value) }); setShopSaved(false); }}
                  className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 font-bold outline-none focus:border-orange-500 bg-[#F6F9FF]" data-testid="wholesale-min-kg-input" />
              </label>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button onClick={() => { saveShop({ collegeName: shopForm.collegeName.trim(), canteenName: shopForm.canteenName.trim() || "College Canteen", groceryName: shopForm.groceryName.trim() || "Campus Grocery Store", jazzcashNumber: shopForm.jazzcashNumber.trim() || SHOP_DEFAULTS.jazzcashNumber, easypaisaNumber: shopForm.easypaisaNumber.trim() || SHOP_DEFAULTS.easypaisaNumber, raastInfo: shopForm.raastInfo.trim() || SHOP_DEFAULTS.raastInfo, wholesaleMinPieces: Number.isFinite(shopForm.wholesaleMinPieces) && shopForm.wholesaleMinPieces > 0 ? Math.round(shopForm.wholesaleMinPieces) : SHOP_DEFAULTS.wholesaleMinPieces, wholesaleMinKg: Number.isFinite(shopForm.wholesaleMinKg) && shopForm.wholesaleMinKg > 0 ? shopForm.wholesaleMinKg : SHOP_DEFAULTS.wholesaleMinKg, closedContactNumber: shopForm.closedContactNumber.trim() || SHOP_DEFAULTS.closedContactNumber, shopOpen: shopForm.shopOpen, tableCount: Math.min(100, Math.max(1, Math.round(Number(shopForm.tableCount)) || SHOP_DEFAULTS.tableCount)), qrJazzCash: shopForm.qrJazzCash, qrEasypaisa: shopForm.qrEasypaisa, qrRaast: shopForm.qrRaast, qrBank: shopForm.qrBank, titleJazzCash: shopForm.titleJazzCash.trim(), titleEasypaisa: shopForm.titleEasypaisa.trim(), titleRaast: shopForm.titleRaast.trim(), titleBank: shopForm.titleBank.trim() }); setShopSaved(true); }}
              className="rounded-xl px-5 py-2.5 font-extrabold text-white" style={{ background: "#16A34A" }}>💾 Save Settings</button>
            {shopSaved && <span className="font-bold" style={{ color: "#16A34A" }}>✓ Saved — names, payment numbers, QR account titles, closed-shop number + wholesale minimums updated everywhere. (QR pictures upload karte hi khud save ho jati hain.)</span>}
          </div>
          </div>
        </section>
        )}

        {ownerTab === "tables" && (
        <section className="bg-white rounded-2xl border border-orange-100 shadow-sm p-4">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
            <h2 className="font-extrabold">🪑 Tables &amp; QR — Print &amp; Stick on Tables</h2>
            <div className="flex flex-wrap gap-2">
              <GuidelineButton entry="owner-tables" />
              <button onClick={() => { document.body.classList.add("print-tables"); window.print(); setTimeout(() => document.body.classList.remove("print-tables"), 500); }}
                className="rounded-xl px-4 py-2 font-extrabold text-white no-print" style={{ background: "#0F172A" }}>🖨️ Print Table Cards</button>
            </div>
          </div>
          <p className="text-sm text-stone-500 mb-3">Every table has its OWN QR. The customer scans it → {shop.canteenName} ordering opens with that table already filled (they can change it). A general canteen QR (no table) can also be printed from the Online Order link: <b>{origin}/online</b></p>
          {/* Table count — Adjustable (1–100). Draft lives in shopForm; Apply
              saves via the same loadShop+saveShop pattern as the Shop Status
              toggle, and the cards below render from the SAVED count (shop),
              so exactly tableCount cards show/print. Past orders/bills keep
              their own table numbers — reducing the count never edits them. */}
          <div className="flex flex-wrap items-center gap-2 mb-4 rounded-2xl border-2 border-dashed border-stone-200 p-3">
            <span className="font-extrabold text-sm">🪑 Kul Tables:</span>
            <button data-testid="table-count-minus" onClick={() => { setShopForm((f) => ({ ...f, tableCount: Math.max(1, (Number(f.tableCount) || 8) - 1) })); setTableCountSaved(false); }}
              className="w-10 h-10 rounded-xl bg-stone-100 font-black text-lg leading-none">−</button>
            <input data-testid="table-count-input" type="number" min={1} max={100} value={shopForm.tableCount}
              onChange={(e) => { setShopForm((f) => ({ ...f, tableCount: e.target.value === "" ? 0 : Number(e.target.value) })); setTableCountSaved(false); }}
              className="w-20 rounded-xl border-2 border-stone-200 px-3 py-2 text-center font-bold outline-none focus:border-orange-500" />
            <button data-testid="table-count-plus" onClick={() => { setShopForm((f) => ({ ...f, tableCount: Math.min(100, (Number(f.tableCount) || 8) + 1) })); setTableCountSaved(false); }}
              className="w-10 h-10 rounded-xl bg-stone-100 font-black text-lg leading-none">+</button>
            <button data-testid="table-count-apply" onClick={() => { const tc = Math.min(100, Math.max(1, Math.round(Number(shopForm.tableCount)) || SHOP_DEFAULTS.tableCount)); saveShop({ ...loadShop(), tableCount: tc }); setShopForm((f) => ({ ...f, tableCount: tc })); setTableCountSaved(true); }}
              className="rounded-xl px-4 py-2.5 font-extrabold text-white" style={{ background: "#16A34A" }}>✓ Apply</button>
            {tableCountSaved && <span className="font-bold" style={{ color: "#16A34A" }}>✓ Saved</span>}
            <span className="text-xs text-stone-500 w-full">Abhi saved: <b>{shop.tableCount} tables</b> (limit 1–100). Apply karte hi neeche utne hi QR cards bante hain aur Online page par bhi sirf <b>Table 1–{shop.tableCount}</b> hi chalegi — us se upar wala number invalid hoga. Count kam karne se purane orders/bills bilkul nahi badalte.</span>
          </div>
          <div id="table-qr-sheet" className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: shop.tableCount }, (_, i) => i + 1).map((n) => (
              <div key={n} data-testid="table-card" className="rounded-2xl border-2 border-dashed border-stone-300 bg-[#FFFBF5] p-4 text-center">
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
