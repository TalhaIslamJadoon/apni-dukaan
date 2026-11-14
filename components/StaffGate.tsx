"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  StaffMember, TabKey, TABS_META, hasRetail, loadStaff, staffLogin, useStaffSession, useShop, firstTabHref,
} from "@/lib/store";

// ─────────────────────────────────────────────────────────────────────────────
// StaffGate — wraps every STAFF page (/, /grocery, /kitchen, /stock, /owner).
// Talha's rule: "Jis banday ko jis chez ka access ho usy just uska tab show
// ho." No staff session → friendly login (pick your name + PIN). A session
// WITHOUT this tab → access notice + automatic redirect to the person's
// first allowed tab, where a small "access nahi hai" banner confirms why.
// The customer page /online is NOT gated — it never uses this component.
// ─────────────────────────────────────────────────────────────────────────────

function roleEmoji(m: StaffMember): string {
  if (m.isOwner) return "👑";
  if (m.tabs.length === 1) return TABS_META.find((t) => t.key === m.tabs[0])?.emoji ?? "👤";
  return "🧑‍🤝‍🧑";
}
function roleLabel(m: StaffMember): string {
  if (m.isOwner) return "Owner — saare tabs";
  const names = m.tabs.map((k) => TABS_META.find((t) => t.key === k)?.short ?? k);
  return names.length ? `Sirf: ${names.join(" + ")}` : "Koi tab nahi";
}

export function StaffLogin() {
  const shop = useShop();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStaff(loadStaff());
    // The staff list is server data (Phase 2) — refresh the cards when it lands.
    const t = setTimeout(() => setStaff(loadStaff()), 1200);
    return () => clearTimeout(t);
  }, []);

  async function tryLogin() {
    const m = staff.find((s) => s.id === selId);
    if (!m) { setErr("Pehle apna naam chunein 👆"); return; }
    setBusy(true);
    // Phase 2: the PIN is verified on the SERVER (hashed credentials) —
    // five wrong tries lock the account for five minutes.
    const member = await staffLogin(m.id, pin);
    setBusy(false);
    if (!member) { setErr("❌ Ghalat PIN — dobara try karein"); setPin(""); return; }
    setErr("");
    // gate re-renders from the session: allowed tab opens, wrong tab redirects
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="text-white shrink-0" style={{ background: "#0F172A" }}>
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="text-2xl">🏪</div>
          <div>
            <div className="text-lg font-extrabold leading-tight">{shop.collegeName || "POS System"}</div>
            <div className="text-xs opacity-70">{[shop.hasCanteen ? shop.canteenName : null, hasRetail(shop) ? shop.groceryName : null].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
      </header>
      <main className="flex-1 flex items-start sm:items-center justify-center p-4">
        <div className="w-full max-w-lg">
          <div className="text-center mb-4">
            <div className="text-5xl mb-1">🔐</div>
            <h1 className="text-2xl font-black">Staff Login</h1>
            <p className="text-stone-500 font-bold text-sm">Apna naam chunein aur PIN dein — aap ko sirf aap ke tabs nazar aayenge.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-4">
            {staff.map((m) => {
              const sel = selId === m.id;
              return (
                <button key={m.id} onClick={() => { setSelId(m.id); setErr(""); }}
                  className="rounded-2xl border-[3px] bg-white p-4 text-left shadow-sm transition active:scale-[0.99]"
                  style={sel ? { borderColor: "#F97316", background: "#FFF7ED" } : { borderColor: "#E7E5E4" }}>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl text-2xl shadow-sm" style={{ background: sel ? "#F97316" : "#F5F5F4" }}>{roleEmoji(m)}</span>
                    <div className="min-w-0">
                      <div className="font-black text-lg leading-tight line-clamp-2">{m.name}</div>
                      <div className="text-xs font-bold text-stone-500">{roleLabel(m)}</div>
                    </div>
                    {sel && <span className="ml-auto font-black" style={{ color: "#16A34A" }}>✓</span>}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="bg-white rounded-3xl shadow-lg border border-orange-100 p-5">
            <label className="block text-sm font-extrabold text-stone-500 mb-1.5">PIN (4 digits)</label>
            <input type="password" inputMode="numeric" maxLength={4} value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter") tryLogin(); }}
              placeholder="••••" autoComplete="off"
              className="w-full rounded-xl border-2 border-stone-200 px-4 py-3.5 text-center text-3xl tracking-[0.4em] font-black outline-none focus:border-orange-500" />
            {err && <p className="mt-2 text-center text-sm font-bold" style={{ color: "#DC2626" }}>{err}</p>}
            <button onClick={tryLogin} disabled={busy} className="mt-3 w-full rounded-2xl py-4 text-xl font-black text-white active:scale-[0.99] disabled:opacity-60" style={{ background: "#F97316" }}>{busy ? "⏳ Check ho raha hai…" : "🔓 Login"}</button>
            <p className="mt-3 text-center text-xs font-bold text-stone-400">Demo PINs — Owner <b>1234</b> · Canteen <b>1111</b> · Grocery <b>2222</b> · Kitchen <b>3333</b> · Stock <b>4444</b></p>
            <p className="mt-1 text-center text-xs text-stone-400">Customer hain? Table ka QR scan karein ya <b>Online Order</b> page kholein — customers ko login nahi chahiye.</p>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function StaffGate({ tab, children }: { tab: TabKey; children: React.ReactNode }) {
  const member = useStaffSession();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [deniedNote, setDeniedNote] = useState("");
  useEffect(() => { setReady(true); }, []);

  const allowed = !!member && member.tabs.includes(tab);

  // Forbidden tab → notice, then auto-redirect to the person's first tab.
  useEffect(() => {
    if (!ready || !member || allowed) return;
    const short = TABS_META.find((t) => t.key === tab)?.short ?? tab;
    try { sessionStorage.setItem("pos-denied-tab", short); } catch { /* ignore */ }
    const id = setTimeout(() => router.replace(firstTabHref(member)), 1800);
    return () => clearTimeout(id);
  }, [ready, member, allowed, tab, router]);

  // Landed somewhere allowed after a denial → show the note once, briefly.
  useEffect(() => {
    if (!ready || !member || !allowed) return;
    let note = "";
    try { note = sessionStorage.getItem("pos-denied-tab") || ""; if (note) sessionStorage.removeItem("pos-denied-tab"); } catch { /* ignore */ }
    if (note) {
      setDeniedNote(note);
      const id = setTimeout(() => setDeniedNote(""), 4000);
      return () => clearTimeout(id);
    }
  }, [ready, member, allowed]);

  if (!ready) {
    return <div className="min-h-screen" style={{ background: "#0F172A" }} />;
  }
  if (!member) return <StaffLogin />;
  if (!allowed) {
    const short = TABS_META.find((t) => t.key === tab)?.short ?? tab;
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-lg border border-orange-100 p-8 w-full max-w-sm text-center pop-in">
          <div className="text-5xl mb-2">⛔</div>
          <h1 className="text-xl font-extrabold mb-1">Access Nahi Hai</h1>
          <p className="text-sm text-stone-500 font-bold">Aap ko <b>{short}</b> tab ka access nahi hai.<br />Aap ke tab par le ja rahe hain…</p>
          <button onClick={() => router.replace(firstTabHref(member))} className="mt-4 w-full rounded-xl py-3 font-extrabold text-white" style={{ background: "#F97316" }}>
            Mere Tab Par Jayein →
          </button>
        </div>
      </div>
    );
  }
  return (
    <>
      {deniedNote && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] rounded-full px-5 py-2.5 font-extrabold text-white shadow-xl pop-in" style={{ background: "#DC2626" }}>
          ⛔ Aap ko {deniedNote} tab ka access nahi hai
        </div>
      )}
      {children}
    </>
  );
}
