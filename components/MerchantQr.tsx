"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, apiPatch, apiDelete, ApiClientError } from "@/lib/api";

// ── Merchant QR Codes — Owner uploads Talha's OFFICIAL payment QRs ─────────
// One card per method (JazzCash / Easypaisa / Raast / Bank). The image lives
// in the database (bytea) and is served to customers on the /online payment
// step: scan the shop's real QR → pay → upload proof → Owner confirms.
// Uploads save IMMEDIATELY (like the Shop Open switch), not via Save Settings.
// From here the Owner can also print a counter 🖨️ QR Stand per method.
interface Merchant {
  id: string;
  provider: string;
  displayName: string;
  refMasked: string | null;
  hasQr: boolean;
  updatedAt: string | null;
  isActive: boolean;
}

const METHODS = [
  { provider: "jazzcash", label: "JazzCash", emoji: "📱" },
  { provider: "easypaisa", label: "Easypaisa", emoji: "📱" },
  { provider: "raast", label: "Raast", emoji: "🏦" },
  { provider: "bank", label: "Bank Transfer", emoji: "🏦" },
] as const;

const qrUrl = (provider: string, v?: string | null) =>
  `/api/v1/public/merchant-qr/${provider}${v ? `?v=${encodeURIComponent(v)}` : ""}`;

export default function MerchantQrSection({ shopTitle, numbers }: {
  shopTitle: string;
  numbers: { jazzcash: string; easypaisa: string; raast: string };
}) {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { title: string; number: string }>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [stand, setStand] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await apiGet<{ merchants: Merchant[] }>("/owner/merchant-accounts");
      setMerchants(d.merchants);
    } catch { /* section simply shows empty cards */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const byProvider = (p: string) => merchants.find((m) => m.provider === p && m.isActive) ?? null;
  const numberFor = (p: string, m: Merchant | null) =>
    m?.refMasked || (p === "jazzcash" ? numbers.jazzcash : p === "easypaisa" ? numbers.easypaisa : p === "raast" ? numbers.raast : "");
  const draftFor = (p: string, label: string, m: Merchant | null) =>
    drafts[p] ?? { title: m?.displayName ?? `${label} — ${shopTitle}`, number: numberFor(p, m) };

  function setDraft(p: string, label: string, m: Merchant | null, patch: Partial<{ title: string; number: string }>) {
    setDrafts((d) => ({ ...d, [p]: { ...draftFor(p, label, m), ...patch } }));
  }

  async function ensureMerchant(p: string, label: string): Promise<Merchant | null> {
    const existing = byProvider(p);
    const draft = draftFor(p, label, existing);
    try {
      if (existing) {
        await apiPatch(`/owner/merchant-accounts/${existing.id}`, { displayName: draft.title.trim(), refMasked: draft.number.trim() || null });
        return existing;
      }
      const r = await apiPost<{ id: string }>("/owner/merchant-accounts", {
        provider: p, displayName: draft.title.trim() || `${label} — ${shopTitle}`, refMasked: draft.number.trim() || null, qrMode: "static",
      });
      await load();
      return { id: r.id, provider: p, displayName: draft.title, refMasked: draft.number || null, hasQr: false, updatedAt: null, isActive: true };
    } catch (e) {
      setMsg((s) => ({ ...s, [p]: `⛔ ${e instanceof ApiClientError ? e.message : "Merchant save nahi hua"}` }));
      return null;
    }
  }

  async function saveTitleNumber(p: string, label: string) {
    setBusy(p);
    const m = await ensureMerchant(p, label);
    if (m) { setMsg((s) => ({ ...s, [p]: "✓ Title / number save ho gaya" })); await load(); }
    setBusy("");
  }

  async function onQrFile(p: string, label: string, file: File | null) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setMsg((s) => ({ ...s, [p]: "⛔ QR image PNG, JPG ya WebP honi chahiye" })); return;
    }
    setBusy(p); setMsg((s) => ({ ...s, [p]: "" }));
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const m = await ensureMerchant(p, label);
      if (!m) return;
      await apiPost(`/owner/merchant-accounts/${m.id}/qr`, { imageBase64: dataUrl.split(",")[1], mime: file.type });
      setMsg((s) => ({ ...s, [p]: "✓ QR lag gaya — customers ko ab Online Payment mein ye QR nazar ayega" }));
      await load();
    } catch (e) {
      setMsg((s) => ({ ...s, [p]: `⛔ ${e instanceof ApiClientError ? e.message : "QR upload nahi hua — dobara koshish karein"}` }));
    } finally { setBusy(""); }
  }

  async function removeQr(p: string) {
    const m = byProvider(p);
    if (!m) return;
    if (!window.confirm(`${p} ka QR hata dein? Customers ko phir sirf number nazar ayega.`)) return;
    setBusy(p);
    try {
      await apiDelete(`/owner/merchant-accounts/${m.id}/qr`);
      setMsg((s) => ({ ...s, [p]: "✓ QR hata diya gaya" }));
      await load();
    } catch (e) {
      setMsg((s) => ({ ...s, [p]: `⛔ ${e instanceof ApiClientError ? e.message : "QR nahi hata"}` }));
    } finally { setBusy(""); }
  }

  function printStand(p: string) {
    setStand(p);
    setTimeout(() => {
      document.body.classList.add("print-qrstand");
      window.print();
      setTimeout(() => document.body.classList.remove("print-qrstand"), 500);
    }, 60);
  }

  const standMethod = METHODS.find((m) => m.provider === stand) ?? null;
  const standMerchant = stand ? byProvider(stand) : null;

  return (
    <div className="mt-4 pt-3 border-t border-dashed border-stone-200" data-testid="merchant-qr-section">
      <div className="font-extrabold mb-1">📷 Merchant QR Codes <span className="text-xs font-bold text-stone-400">(scan-and-pay)</span></div>
      <p className="text-sm text-stone-500 mb-3">
        Har method ka <b>asal QR</b> (JazzCash/Easypaisa/Raast/Bank app wala) yahan upload karein — customer Online Payment mein method
        choose kare to bara QR nazar ayega: scan karke payment, phir screenshot (proof) upload. Upload foran save hota hai,
        neeche wala <b>Save Settings</b> dabane ki zaroorat nahi.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {METHODS.map(({ provider, label, emoji }) => {
          const m = byProvider(provider);
          const draft = draftFor(provider, label, m);
          return (
            <div key={provider} className="rounded-2xl border-2 border-stone-200 p-3" data-testid={`merchant-card-${provider}`}>
              <div className="font-extrabold mb-2">{emoji} {label}</div>
              <div className="flex gap-3">
                <div className="w-28 h-28 shrink-0 rounded-xl border-2 border-dashed border-stone-300 bg-[#FFFBF5] flex items-center justify-center overflow-hidden">
                  {m?.hasQr
                    ? <img src={qrUrl(provider, m.updatedAt)} alt={`${label} QR`} className="w-full h-full object-contain" data-testid={`merchant-qr-preview-${provider}`} />
                    : <span className="text-[11px] font-bold text-stone-400 text-center px-1">QR nahi<br />laga hua</span>}
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <label className="block">
                    <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Account Title</span>
                    <input value={draft.title} onChange={(e) => setDraft(provider, label, m, { title: e.target.value })}
                      className="w-full rounded-lg border-2 border-stone-200 px-2.5 py-2 text-sm font-bold outline-none focus:border-orange-500 bg-[#F6F9FF]" placeholder="e.g. Talha Islam" />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] font-bold uppercase tracking-wide text-stone-500 mb-0.5">Number / IBAN</span>
                    <input value={draft.number} onChange={(e) => setDraft(provider, label, m, { number: e.target.value })}
                      className="w-full rounded-lg border-2 border-stone-200 px-2.5 py-2 text-sm font-bold outline-none focus:border-orange-500 bg-[#F6F9FF]" placeholder="03XX-XXXXXXX / IBAN" />
                  </label>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3">
                <button onClick={() => saveTitleNumber(provider, label)} disabled={busy === provider}
                  className="rounded-lg px-3 py-2 text-sm font-extrabold bg-stone-100 disabled:opacity-60">💾 Title/Number</button>
                <label className="rounded-lg px-3 py-2 text-sm font-extrabold text-white cursor-pointer" style={{ background: "#F97316" }}>
                  {busy === provider ? "Upload ho raha hai…" : m?.hasQr ? "📷 QR Badlein" : "📷 QR Upload"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" data-testid={`merchant-qr-file-${provider}`}
                    onChange={(e) => { onQrFile(provider, label, e.target.files?.[0] ?? null); e.target.value = ""; }} />
                </label>
                {m?.hasQr && (
                  <>
                    <button onClick={() => printStand(provider)} className="rounded-lg px-3 py-2 text-sm font-extrabold text-white" style={{ background: "#0F172A" }}>🖨️ QR Stand</button>
                    <button onClick={() => removeQr(provider)} disabled={busy === provider}
                      className="rounded-lg px-3 py-2 text-sm font-extrabold text-white disabled:opacity-60" style={{ background: "#DC2626" }}>🗑️ Remove</button>
                  </>
                )}
              </div>
              {msg[provider] && <p className="font-bold text-sm mt-2" style={{ color: msg[provider].startsWith("✓") ? "#16A34A" : "#DC2626" }}>{msg[provider]}</p>}
            </div>
          );
        })}
      </div>

      {/* QR Stand — screen par preview modal; print mein sirf sheet ati hai
          (body.print-qrstand + globals.css ka tareeqa, table cards jaisa). */}
      {stand && standMethod && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-4 max-w-sm w-full">
            <div id="qr-stand-sheet" className="rounded-2xl border-4 p-5 text-center" style={{ borderColor: "#F97316" }}>
              <div className="text-sm font-black tracking-widest text-stone-400">{shopTitle}</div>
              <div className="text-2xl font-black mt-1">{standMethod.emoji} {standMethod.label}</div>
              <div className="text-sm font-bold text-stone-500">Scan karke payment karein</div>
              <img src={qrUrl(standMethod.provider, standMerchant?.updatedAt)} alt={`${standMethod.label} QR`}
                className="w-64 h-64 object-contain mx-auto my-3 rounded-xl border border-stone-200 bg-white" />
              <div className="font-black text-lg leading-tight">{standMerchant?.displayName ?? standMethod.label}</div>
              <div className="font-bold text-stone-600 break-all">{numberFor(standMethod.provider, standMerchant)}</div>
              <div className="text-[11px] font-bold text-stone-400 mt-2">Payment ke baad screenshot counter par dikhayein ya online order mein upload karein</div>
            </div>
            <div className="flex gap-2 mt-3 no-print">
              <button onClick={() => printStand(standMethod.provider)} className="flex-1 rounded-xl px-4 py-2.5 font-extrabold text-white" style={{ background: "#0F172A" }}>🖨️ Print Stand</button>
              <button onClick={() => setStand(null)} className="rounded-xl px-4 py-2.5 font-bold bg-stone-100">✕ Band Karein</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
