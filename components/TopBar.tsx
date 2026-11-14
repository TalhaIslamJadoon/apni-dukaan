"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import AIAssistant from "@/components/AIAssistant";
import { GuidelineButton } from "@/components/Guideline";
import { TABS_META, hasRetail, setStaffSession, useShop, useStaffSession } from "@/lib/store";
import { templateOf } from "@/lib/templates";
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
      className="rounded-full px-3.5 py-1.5 text-xs font-extrabold text-white transition hover:brightness-125 active:scale-[0.98] shrink-0 whitespace-nowrap"
      style={{ background: st.on ? "#16A34A" : "#57534E" }}>
      {/* Mobile: short label — the full "Sound: ON — ek click karein" pill
          alone is ~216px and pushed the whole header off small screens. */}
      <span className="sm:hidden">{!st.on ? "🔕 OFF" : "🔔 ON"}</span>
      <span className="hidden sm:inline">{!st.on ? "🔕 Sound: OFF" : st.armed ? "🔔 Sound: ON" : "🔔 Sound: ON — ek click karein"}</span>
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

  // BUSINESS SETUP gating (Talha, 15 Nov 2026): staff ke allowed tabs ke
  // UPAR business filter — jo dukaan setup mein off hai us ke tabs yahan
  // bhi nahi dikhte (canteen tabs sirf hasCanteen par; grocery + stock
  // tabs sirf retail par). Retail tab ka label dukaan ki qisam ke hisaab
  // se badalta hai (grocery apna purana "Grocery POS" rakhta hai).
  const retailOn = hasRetail(shop);
  const tpl = templateOf(shop.retailType);
  const groceryTabLabel = retailOn && shop.retailType !== "grocery" && tpl
    ? `${tpl.emoji} ${tpl.label} POS`
    : undefined;
  const visibleTabs = member ? TABS_META.filter((t) => member.tabs.includes(t.key)).filter((t) => {
    if (t.key === "canteen" || t.key === "kitchen") return shop.hasCanteen;
    if (t.key === "grocery" || t.key === "stock") return retailOn;
    return true;
  }) : [];
  const shopNamesLine = [
    shop.hasCanteen ? shop.canteenName : null,
    retailOn ? shop.groceryName : null,
  ].filter(Boolean).join(" · ");
  // Per-screen help lives beside the other TopBar actions. Owner gets its
  // richer tab-wise buttons inside the dashboard; /online gets a floating
  // button, so neither is duplicated here.
  const guidelineEntry =
    path === "/" ? "canteen" :
    path === "/grocery" ? "grocery" :
    path === "/kitchen" ? "kitchen" :
    path === "/stock" ? "stock" :
    null;

  return (
    <header className="text-white shrink-0" style={{ background: "#0F172A" }}>
      {/* flex-wrap: on phones the action pills (Guideline + AI + Sound +
          Logout) flow onto a second row inside the header instead of
          forcing the page wider than the screen. Desktop fits one row. */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 px-3 sm:px-4 pt-3 pb-2">
        <div className="text-2xl">🏪</div>
        <div className="flex-1 min-w-0 max-sm:basis-[calc(100%-2.75rem)]">
          <div className="text-lg font-extrabold leading-tight line-clamp-2">{shop.collegeName || "POS System"}</div>
          <div className="text-xs opacity-70 line-clamp-2">{shopNamesLine} · SAMPLE data — real lists pending</div>
        </div>
        {guidelineEntry && <GuidelineButton entry={guidelineEntry} variant="topbar" />}
        <AIAssistant variant="topbar" />
        {member && (
          <>
            {/* Customer TV screens — dono store ki ALAG screens (Talha,
                15 Nov 2026): canteen order board, grocery order board,
                canteen menu board, grocery board. View-only pages, opened
                in a new tab so the counter tab stays put; the screens
                themselves need no PIN. Compact pills; full label from md
                up, short label below so the header still wraps cleanly. */}
            {[
              ...(shop.hasCanteen ? [
                { href: "/display", icon: "🍽️", full: "Canteen Order", short: "Canteen", title: "Canteen Order Screen (TV) — canteen tokens: Ordered / Preparing / Taiyar live" },
                { href: "/menu-board", icon: "🍔", full: "Canteen Menu", short: "Menu", title: "Canteen Menu Board (TV) — canteen menu har 10 second mein khud badalta hai" },
              ] : []),
              ...(retailOn ? [
                { href: "/display-grocery", icon: "🛒", full: "Grocery Order", short: "Grocery", title: "Grocery Order Screen (TV) — online grocery tokens: Ordered / Packing / Taiyar live" },
                { href: "/grocery-board", icon: "🧺", full: "Grocery Board", short: "Board", title: "Grocery Board (TV) — Offers + saari grocery items, har 10 second mein khud badalta hai" },
              ] : []),
            ].map((s) => (
              <a key={s.href} href={s.href} target="_blank" rel="noreferrer" title={s.title}
                className="rounded-full px-3 py-1.5 text-[11px] sm:text-xs font-extrabold text-white transition hover:brightness-125 active:scale-[0.98] shrink-0 whitespace-nowrap"
                style={{ background: "#334155" }}>
                {s.icon} <span className="hidden md:inline">{s.full}</span><span className="md:hidden">{s.short}</span>
              </a>
            ))}
          </>
        )}
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
                {t.key === "grocery" && groceryTabLabel ? groceryTabLabel : t.label}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}
