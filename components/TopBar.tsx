"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import AIAssistant from "@/components/AIAssistant";
import { TABS_META, setStaffSession, useShop, useStaffSession } from "@/lib/store";
import { audioArmed, setSoundOn, soundOn } from "@/lib/alerts";

// 🔔 Sound toggle for the staff order alerts (voice + beep). Browsers
// block audio until the first click/keypress, so the toggle states the
// armed status honestly: ON but not yet armed → "ek click karein".
function SoundToggle() {
  const [st, setSt] = useState({ on: true, armed: false });
  useEffect(() => {
    const read = () => setSt({ on: soundOn(), armed: audioArmed() });
    read();
    const t = setInterval(read, 1000);
    window.addEventListener("pos-sound-changed", read);
    return () => { clearInterval(t); window.removeEventListener("pos-sound-changed", read); };
  }, []);
  return (
    <button onClick={() => setSoundOn(!st.on)} data-testid="sound-toggle"
      title={st.on
        ? st.armed ? "Order alerts ki awaaz ON hai — band karne ke liye dabayein" : "Awaaz ON hai lekin browser rule: pehle screen par ek dafa click karein, tab awaaz arm hogi"
        : "Order alerts ki awaaz OFF hai — on karne ke liye dabayein"}
      className="rounded-full px-3.5 py-1.5 text-xs font-extrabold text-white transition hover:brightness-125 active:scale-[0.98] shrink-0"
      style={{ background: st.on ? "#16A34A" : "#57534E" }}>
      {!st.on ? "🔕 Sound: OFF" : st.armed ? "🔔 Sound: ON" : "🔔 Sound: ON — ek click karein"}
    </button>
  );
}

// Shared header (Dark Slate #0F172A) + tab strip for every screen.
// Active tab = Primary Orange #F97316.
//
// ROLE-BASED TABS (Talha, 14 Nov 2026): the strip shows ONLY the tabs the
// logged-in staff member is allowed (Owner sees all). The header also shows
// who is logged in + a Logout / Switch User button.
// /online is the CUSTOMER page: with no staff session it renders in
// customer mode — shop header only, NO staff tabs at all.
export default function TopBar() {
  const path = usePathname();
  const shop = useShop();
  const member = useStaffSession();
  const onOnline = path === "/online";

  const visibleTabs = member ? TABS_META.filter((t) => member.tabs.includes(t.key)) : [];

  return (
    <header className="text-white shrink-0" style={{ background: "#0F172A" }}>
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        <div className="text-2xl">🏪</div>
        <div className="flex-1 min-w-0">
          <div className="text-lg font-extrabold leading-tight truncate">{shop.collegeName || "POS System"}</div>
          <div className="text-xs opacity-70 truncate">{shop.canteenName} · {shop.groceryName} · SAMPLE data — real lists pending</div>
        </div>
        <AIAssistant variant="topbar" />
        {member && <SoundToggle />}
        {member && (
          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden sm:inline-flex items-center rounded-full px-3 py-1.5 text-xs font-extrabold" style={{ background: "rgba(255,255,255,0.12)" }}>
              👤 {member.name}{member.isOwner ? " 👑" : ""}
            </span>
            <button onClick={() => setStaffSession(null)}
              className="rounded-full px-3.5 py-1.5 text-xs font-extrabold text-white transition hover:brightness-125 active:scale-[0.98]"
              style={{ background: "#DC2626" }}>
              ⏻ Logout
            </button>
          </div>
        )}
      </div>
      {(!onOnline || member) && visibleTabs.length > 0 && (
        <nav className="flex gap-2 px-3 pb-3 overflow-x-auto">
          {visibleTabs.map((t) => {
            const active = path === t.href;
            return (
              <Link key={t.href} href={t.href}
                className="rounded-xl px-5 py-2.5 font-extrabold whitespace-nowrap transition hover:brightness-125"
                style={active ? { background: "#F97316", color: "#fff", boxShadow: "0 4px 14px rgba(249,115,22,0.45)" } : { background: "rgba(255,255,255,0.10)", color: "#E7E5E4" }}>
                {t.label}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}
