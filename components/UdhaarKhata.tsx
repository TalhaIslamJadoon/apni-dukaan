"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, ApiClientError } from "@/lib/api";

// ── Udhaar Khata — Owner's credit ledger ────────────────────────────────────
// Charges land here automatically when a bill/order is settled on Udhaar
// (counter name-khata, table-QR with ID, remote account with ID). This screen
// is where the Owner sees every khata, its full ledger and — the point of the
// screen — records WASOOLI (repayments) against the real server balance.
// Amounts arrive from the API in rupees (server converts paisa → Rs once).
export interface UdhaarAccount {
  id: string;
  name: string;
  externalId: string | null;
  mobile: string | null;
  balance: number;
  totalCharged: number;
  totalPaid: number;
  creditLimit: number | null;
}

export interface UdhaarLedgerEntry {
  id: string;
  type: "charge" | "payment" | "adjustment" | "reversal";
  amount: number; // signed: charge +, wasooli −
  balanceAfter: number;
  billNo: string | null;
  method: string | null;
  byName: string | null;
  note: string | null;
  at: string;
}

const METHODS = [
  { v: "cash", label: "💵 Cash" },
  { v: "jazzcash", label: "📱 JazzCash" },
  { v: "easypaisa", label: "📱 Easypaisa" },
  { v: "raast", label: "🏦 Raast" },
  { v: "bank", label: "🏦 Bank Transfer" },
];
const METHOD_LABEL: Record<string, string> = {
  cash: "Cash", jazzcash: "JazzCash", easypaisa: "Easypaisa", raast: "Raast", bank: "Bank", other: "Other",
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function UdhaarKhataSection() {
  const [accounts, setAccounts] = useState<UdhaarAccount[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ledger, setLedger] = useState<UdhaarLedgerEntry[]>([]);
  const [loadErr, setLoadErr] = useState("");
  const [form, setForm] = useState<{ amount: string; method: string; note: string }>({ amount: "", method: "cash", note: "" });
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const loadAccounts = useCallback(async () => {
    try {
      const d = await apiGet<{ accounts: UdhaarAccount[] }>("/owner/udhaar/accounts");
      setAccounts(d.accounts);
      setLoadErr("");
    } catch (e) {
      setLoadErr(e instanceof ApiClientError ? e.message : "Khaatay load nahi hue — server check karein");
    }
  }, []);

  const loadLedger = useCallback(async (accountId: string) => {
    try {
      const d = await apiGet<{ entries: UdhaarLedgerEntry[] }>(`/owner/udhaar/accounts/${accountId}/ledger`);
      setLedger(d.entries);
    } catch { setLedger([]); }
  }, []);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  // Khata kabhi stale na rahe — har 10s silent refresh (form state untouched).
  useEffect(() => {
    const t = setInterval(() => { loadAccounts(); if (selectedId) loadLedger(selectedId); }, 10000);
    return () => clearInterval(t);
  }, [loadAccounts, loadLedger, selectedId]);

  const selected = accounts.find((a) => a.id === selectedId) ?? null;
  const totalBaqaya = accounts.reduce((s, a) => s + a.balance, 0);
  const withBaqaya = accounts.filter((a) => a.balance > 0).length;

  const q = search.trim().toLowerCase();
  const visible = accounts.filter((a) =>
    !q || a.name.toLowerCase().includes(q) || (a.externalId ?? "").toLowerCase().includes(q) || (a.mobile ?? "").includes(q)
  );

  function openAccount(a: UdhaarAccount) {
    setSelectedId(a.id);
    setMsg("");
    setForm({ amount: "", method: "cash", note: "" });
    loadLedger(a.id);
  }

  async function saveWasooli() {
    if (!selected || saving) return;
    const amt = parseFloat(form.amount);
    if (!(amt > 0)) { setMsg("⚠️ Wasooli ki raqam sahi likhein (0 se zyada)"); return; }
    if (amt > selected.balance) {
      setMsg(`⛔ Wasooli baqaya se zyada nahi ho sakti — is khaatay ka baqaya sirf Rs ${selected.balance.toLocaleString()} hai`);
      return;
    }
    setSaving(true); setMsg("");
    try {
      const r = await apiPost<{ balance: number }>(`/owner/udhaar/accounts/${selected.id}/payments`, {
        amount: amt, method: form.method, note: form.note.trim() || undefined,
      });
      setMsg(`✓ Rs ${amt.toLocaleString()} wasooli darj ho gayi — ${selected.name} ka naya baqaya Rs ${Number(r.balance).toLocaleString()} hai`);
      setForm({ amount: "", method: "cash", note: "" });
      await loadAccounts();
      await loadLedger(selected.id);
    } catch (e) {
      setMsg(`⛔ ${e instanceof ApiClientError ? e.message : "Wasooli save nahi hui — dobara koshish karein"}`);
    } finally { setSaving(false); }
  }

  return (
    <section className="bg-white rounded-2xl border border-orange-100 shadow-sm p-4" data-testid="udhaar-section">
      <h2 className="font-extrabold mb-1">💰 Udhaar Khata — Kis Ke Naam Kitna Baqaya Hai</h2>
      <p className="text-sm text-stone-500 mb-3">
        Udhaar bills se har customer ka khata khud banta hai. Khaata kholein, poora ledger dekhein aur jab paisay milen to
        <b> Wasooli Darj Karein</b> — baqaya foran kam ho jayega.
      </p>

      {/* Totals header */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="rounded-2xl px-4 py-3 text-white min-w-[190px]" style={{ background: "#F59E0B" }}>
          <div className="text-[11px] font-black uppercase tracking-wide opacity-90">Kul Baqaya — Sab Khaatay</div>
          <div className="text-2xl font-black" data-testid="udhaar-total-baqaya">Rs {totalBaqaya.toLocaleString()}</div>
        </div>
        <div className="rounded-2xl px-4 py-3 bg-orange-50 border border-orange-100 min-w-[140px]">
          <div className="text-[11px] font-black uppercase tracking-wide text-stone-500">Kul Khaatay</div>
          <div className="text-2xl font-black">{accounts.length}</div>
        </div>
        <div className="rounded-2xl px-4 py-3 bg-orange-50 border border-orange-100 min-w-[140px]">
          <div className="text-[11px] font-black uppercase tracking-wide text-stone-500">Jin Ka Baqaya Hai</div>
          <div className="text-2xl font-black">{withBaqaya}</div>
        </div>
        <button onClick={() => { loadAccounts(); if (selectedId) loadLedger(selectedId); }} className="ml-auto self-start rounded-xl px-4 py-2 font-bold bg-stone-100">🔄 Refresh</button>
      </div>

      {loadErr && <p className="font-bold text-sm mb-3" style={{ color: "#DC2626" }}>⛔ {loadErr}</p>}

      <input value={search} onChange={(e) => setSearch(e.target.value)} data-testid="udhaar-search"
        placeholder="🔍 Naam, Student/Staff ID ya mobile se khaata dhoondein…"
        className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 mb-3 outline-none focus:border-orange-500" />

      {/* Accounts list */}
      <div className="space-y-1.5 mb-4">
        {visible.length === 0 && (
          <p className="text-sm font-bold text-stone-400 py-3 text-center">
            {accounts.length === 0 ? "Abhi koi udhaar khata nahi hai — pehla udhaar bill lagte hi khata yahan ban jayega." : "Is search se koi khata nahi mila."}
          </p>
        )}
        {visible.map((a) => (
          <button key={a.id} onClick={() => openAccount(a)} data-testid="udhaar-row"
            className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2 text-left transition hover:bg-orange-50"
            style={selectedId === a.id ? { background: "#FFF7ED", borderColor: "#F97316", borderWidth: 2 } : { background: "#FFFBF5", borderColor: "#FDE8D7" }}>
            <span className="text-xl">📒</span>
            <span className="font-extrabold">{a.name}</span>
            {a.externalId && <span className="text-[11px] font-bold rounded-full bg-white border border-stone-200 px-2 py-0.5">ID: {a.externalId}</span>}
            {a.mobile && <span className="text-[11px] font-bold rounded-full bg-white border border-stone-200 px-2 py-0.5">📱 {a.mobile}</span>}
            <span className="ml-auto flex flex-wrap items-center gap-x-3 text-sm">
              <span className="text-stone-500">Kul Udhaar <b className="text-stone-800">Rs {a.totalCharged.toLocaleString()}</b></span>
              <span className="text-stone-500">Wasool <b style={{ color: "#16A34A" }}>Rs {a.totalPaid.toLocaleString()}</b></span>
              {a.balance > 0
                ? <span className="font-black" style={{ color: "#DC2626" }}>Baqaya Rs {a.balance.toLocaleString()}</span>
                : <span className="font-black" style={{ color: "#16A34A" }}>✓ Clear</span>}
            </span>
          </button>
        ))}
      </div>

      {/* Selected account — ledger + wasooli form */}
      {selected && (
        <div className="rounded-2xl border-2 border-dashed border-stone-200 p-3" data-testid="udhaar-detail">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-2xl">📒</span>
            <span className="font-black text-lg">{selected.name}</span>
            {selected.externalId && <span className="text-xs font-bold text-stone-500">ID: {selected.externalId}</span>}
            {selected.mobile && <span className="text-xs font-bold text-stone-500">📱 {selected.mobile}</span>}
            <span className="ml-auto font-black" style={{ color: selected.balance > 0 ? "#DC2626" : "#16A34A" }}>
              Baqaya: Rs {selected.balance.toLocaleString()}
            </span>
            <button onClick={() => setSelectedId(null)} className="rounded-lg px-3 py-1.5 font-bold bg-stone-100 text-sm">✕ Band Karein</button>
          </div>

          {/* Wasooli form */}
          {selected.balance > 0 ? (
            <div className="rounded-2xl bg-green-50/70 border border-green-200 p-3 mb-3">
              <div className="font-extrabold mb-2">💰 Wasooli Darj Karein</div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="block w-36">
                  <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Raqam (Rs)</span>
                  <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d.]/g, "") })}
                    placeholder="e.g. 500" inputMode="decimal" data-testid="wasooli-amount"
                    className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-green-600 bg-white" />
                </label>
                <label className="block">
                  <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Method</span>
                  <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} data-testid="wasooli-method"
                    className="rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none bg-white">
                    {METHODS.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
                  </select>
                </label>
                <label className="block flex-1 min-w-[180px]">
                  <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Note (Optional)</span>
                  <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
                    placeholder="e.g. aadhi payment mili" data-testid="wasooli-note"
                    className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-green-600 bg-white" />
                </label>
                <button onClick={saveWasooli} disabled={saving} data-testid="wasooli-submit"
                  className="rounded-xl px-5 py-2.5 font-extrabold text-white disabled:opacity-60" style={{ background: "#16A34A" }}>
                  {saving ? "Save ho raha hai…" : "✓ Wasooli Darj Karein"}
                </button>
              </div>
              {msg && <p className="font-bold text-sm mt-2" data-testid="wasooli-msg" style={{ color: msg.startsWith("✓") ? "#16A34A" : "#DC2626" }}>{msg}</p>}
            </div>
          ) : (
            <p className="font-bold text-sm mb-3" style={{ color: "#16A34A" }}>✅ Is khaatay ka koi baqaya nahi — wasooli darj karne ki zaroorat nahi.</p>
          )}

          {/* Ledger */}
          <div className="font-extrabold mb-2">📜 Khata Ledger — Har Charge aur Wasooli</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="udhaar-ledger">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-stone-500 border-b border-stone-200">
                  <th className="py-1.5 pr-2">Tareekh</th>
                  <th className="py-1.5 pr-2">Tafseel</th>
                  <th className="py-1.5 pr-2 text-right">Raqam</th>
                  <th className="py-1.5 pr-2 text-right">Baqaya</th>
                  <th className="py-1.5">Darj Kiya</th>
                </tr>
              </thead>
              <tbody>
                {ledger.length === 0 && (
                  <tr><td colSpan={5} className="py-3 text-center font-bold text-stone-400">Is khaatay mein abhi koi entry nahi hai.</td></tr>
                )}
                {ledger.map((e) => (
                  <tr key={e.id} className="border-b border-stone-100 align-top">
                    <td className="py-1.5 pr-2 whitespace-nowrap text-stone-500">{fmtDate(e.at)}</td>
                    <td className="py-1.5 pr-2">
                      {e.type === "charge" && <>🧾 <b>Udhaar Charge</b>{e.billNo ? <span className="text-stone-500"> — Bill {e.billNo}</span> : ""}</>}
                      {e.type === "payment" && <>💰 <b>Wasooli</b>{e.method ? <span className="text-stone-500"> — {METHOD_LABEL[e.method] ?? e.method}</span> : ""}</>}
                      {e.type === "adjustment" && <>🛠️ <b>Adjustment</b></>}
                      {e.type === "reversal" && <>↩️ <b>Reversal</b></>}
                      {e.note && <div className="text-xs text-stone-500">Note: {e.note}</div>}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-extrabold whitespace-nowrap" style={{ color: e.amount >= 0 ? "#D97706" : "#16A34A" }}>
                      {e.amount >= 0 ? "+" : "−"} Rs {Math.abs(e.amount).toLocaleString()}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-bold whitespace-nowrap">Rs {e.balanceAfter.toLocaleString()}</td>
                    <td className="py-1.5 text-stone-500">{e.byName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
