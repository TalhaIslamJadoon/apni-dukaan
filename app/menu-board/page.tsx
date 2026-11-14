"use client";

// ─────────────────────────────────────────────────────────────────────────────
// 📺 MENU BOARD (/menu-board) — KFC-style digital menu TV for the shop front.
// Slides of the canteen menu grouped by category; every slide shows for
// 10 seconds, then the board advances on its own, looping forever. Data
// comes from the LIVE menu store (same loadMenu() the POS + Owner use;
// in Phase 2 that cache is hydrated from the server, so edits made on
// any device land here too) — an owner price/name/photo edit shows up
// on the next loop with no code change. VIEW-ONLY: no PIN, no controls.
//
// TESTING AID: ?sec=2 shortens the slide interval (default stays 10s).
// SLIDE RULE: a category with more items than fit is split into parts of
// ≤8 item cards (4 × 2 at TV sizes) — "Fast Food (2/2)" style headers.
// PHOTOS: the item's own image, with the established emoji fallback when
// there is no photo (or the photo fails to load).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES, CATEGORY_STYLE, Category, MenuItem, loadMenu, useShop } from "@/lib/store";

const ITEMS_PER_SLIDE = 8;

interface Slide { category: Category; items: MenuItem[]; part: number; parts: number }

function buildSlides(menu: MenuItem[]): Slide[] {
  const canteen = menu.filter((m) => m.mode !== "grocery");
  const slides: Slide[] = [];
  for (const cat of CATEGORIES) {
    const items = canteen.filter((m) => m.category === cat);
    if (!items.length) continue;
    const parts = Math.ceil(items.length / ITEMS_PER_SLIDE);
    for (let p = 0; p < parts; p++) {
      slides.push({ category: cat, items: items.slice(p * ITEMS_PER_SLIDE, (p + 1) * ITEMS_PER_SLIDE), part: p + 1, parts });
    }
  }
  return slides;
}

function ItemCard({ item }: { item: MenuItem }) {
  const [imgOk, setImgOk] = useState(true);
  const style = CATEGORY_STYLE[item.category];
  const showImg = Boolean(item.image) && imgOk;
  return (
    <div className="rounded-3xl overflow-hidden bg-white flex flex-col min-h-0"
      style={{ boxShadow: "0 10px 26px rgba(0,0,0,0.45)" }}>
      <div className="relative flex-1 min-h-0" style={{ background: style.bg }}>
        {showImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.image} alt={item.name} onError={() => setImgOk(false)}
            className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center" style={{ fontSize: "clamp(3.5rem, 7vw, 7.5rem)" }}>
            {item.emoji}
          </div>
        )}
        <span className="absolute top-3 left-3 rounded-full px-3 py-1 font-black text-white"
          style={{ background: style.chip, fontSize: "clamp(0.7rem, 1.1vw, 1rem)" }}>
          {style.label}
        </span>
      </div>
      <div className="flex items-center gap-3 px-4 sm:px-5 py-3 sm:py-4 shrink-0">
        <div className="flex-1 min-w-0 font-black leading-tight truncate" style={{ color: "#0F172A", fontSize: "clamp(1.1rem, 2vw, 1.9rem)" }}>
          {item.name}
        </div>
        <div className="font-black whitespace-nowrap" style={{ color: "#F97316", fontSize: "clamp(1.3rem, 2.4vw, 2.3rem)" }}>
          Rs {item.price}
        </div>
      </div>
    </div>
  );
}

export default function MenuBoardPage() {
  const shop = useShop();
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [sec, setSec] = useState(10);
  const [clock, setClock] = useState(() => new Date());
  const [showExit, setShowExit] = useState(true);
  const menuJsonRef = useRef("");

  // Slide interval (?sec= — testing aid only; shipped default is 10)
  useEffect(() => {
    const s = Number(new URLSearchParams(window.location.search).get("sec"));
    if (s >= 1 && s <= 60) setSec(s);
  }, []);

  // Live menu: storage event (owner tab edits) + 2s poll — same store the
  // POS screens read, so price/name edits land without any code change.
  useEffect(() => {
    const read = () => {
      const m = loadMenu();
      const j = JSON.stringify(m);
      if (j !== menuJsonRef.current) { menuJsonRef.current = j; setMenu(m); }
    };
    read();
    const t = setInterval(read, 2000);
    window.addEventListener("storage", read);
    return () => { clearInterval(t); window.removeEventListener("storage", read); };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const slides = useMemo(() => buildSlides(menu), [menu]);
  const safeIdx = slides.length ? idx % slides.length : 0;
  const slide = slides[safeIdx];

  // Auto-rotate: advance every `sec`, looping forever.
  useEffect(() => {
    if (slides.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % slides.length), sec * 1000);
    return () => clearInterval(t);
  }, [slides.length, sec]);

  // Exit control auto-fades after 4s; mouse move / touch brings it back.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const wake = () => { setShowExit(true); clearTimeout(t); t = setTimeout(() => setShowExit(false), 4000); };
    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("touchstart", wake);
    return () => { clearTimeout(t); window.removeEventListener("mousemove", wake); window.removeEventListener("touchstart", wake); };
  }, []);

  const cols = !slide ? 4 : slide.items.length <= 2 ? Math.max(slide.items.length, 1) : slide.items.length <= 6 ? 3 : 4;
  const rows = slide ? Math.max(1, Math.ceil(slide.items.length / cols)) : 1;

  return (
    <div className="h-screen flex flex-col text-white select-none overflow-hidden" style={{ background: "#0F172A" }}>
      {/* Header — shop name + clock */}
      <header className="flex items-center gap-4 px-6 sm:px-10 pt-5 pb-3 shrink-0">
        <div className="text-4xl sm:text-5xl">🏪</div>
        <div className="flex-1 min-w-0">
          <div className="font-black leading-none truncate" style={{ fontSize: "clamp(1.6rem, 3.6vw, 3rem)" }}>
            {shop.canteenName}
            <span className="ml-4 font-extrabold" style={{ color: "#F97316", fontSize: "0.62em" }}>MENU</span>
          </div>
          {shop.collegeName && (
            <div className="opacity-60 font-bold truncate mt-0.5" style={{ fontSize: "clamp(0.8rem, 1.2vw, 1.05rem)" }}>{shop.collegeName}</div>
          )}
        </div>
        <div className="font-black tabular-nums shrink-0" style={{ color: "#F97316", fontSize: "clamp(1.3rem, 2.6vw, 2.4rem)" }}>
          {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </header>

      {slide ? (
        <main key={`${slide.category}-${slide.part}-${menuJsonRef.current.length}`} className="fade-slide flex-1 flex flex-col min-h-0 px-4 sm:px-8 pb-4">
          {/* Category banner */}
          <div className="flex items-end gap-4 shrink-0 pb-3">
            <h2 className="font-black leading-none text-white" style={{ fontSize: "clamp(2rem, 4.6vw, 4.2rem)" }}>
              {slide.category}
            </h2>
            {slide.parts > 1 && (
              <span className="font-black rounded-full px-4 py-1 mb-2" style={{ background: "#F97316", fontSize: "clamp(0.85rem, 1.3vw, 1.2rem)" }}>
                {slide.part} / {slide.parts}
              </span>
            )}
            <span className="flex-1 mb-3 hidden sm:block" style={{ borderTop: "3px dashed rgba(255,255,255,0.25)" }} />
            <span className="font-bold opacity-60 mb-1.5 shrink-0" style={{ fontSize: "clamp(0.85rem, 1.3vw, 1.2rem)" }}>
              Slide {safeIdx + 1} of {slides.length}
            </span>
          </div>

          {/* Item cards — 2-col stack on portrait, wide TV grid via .mb-cols-N */}
          <div className={`flex-1 min-h-0 grid gap-4 sm:gap-5 grid-cols-2 mb-cols-${cols}`}
            style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
            {slide.items.map((item) => <ItemCard key={item.id} item={item} />)}
          </div>
        </main>
      ) : (
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-7xl mb-4">🍽️</div>
            <div className="font-black text-3xl">Menu jald araha hai…</div>
          </div>
        </main>
      )}

      {/* Progress bar + dots — position inside the loop */}
      <footer className="shrink-0 px-6 sm:px-10 pb-5">
        <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.15)" }}>
          {slides.length > 1 && (
            <div key={safeIdx} className="h-full rounded-full"
              style={{ background: "#F97316", animation: `progressGrow ${sec}s linear forwards` }} />
          )}
        </div>
        <div className="flex justify-center gap-2 mt-3">
          {slides.map((s, i) => (
            <span key={`${s.category}-${s.part}`} className="rounded-full transition-all"
              style={{ width: i === safeIdx ? 26 : 10, height: 10, background: i === safeIdx ? "#F97316" : "rgba(255,255,255,0.35)" }} />
          ))}
        </div>
      </footer>

      {/* Exit — tiny corner control, auto-fades */}
      <button onClick={() => window.close()} aria-label="Band karein"
        className="fixed bottom-3 right-3 z-50 rounded-full px-4 py-2 text-sm font-extrabold text-white transition-opacity duration-700"
        style={{ background: "rgba(220,38,38,0.9)", opacity: showExit ? 0.85 : 0 }}>
        ✕ Band karein
      </button>
    </div>
  );
}
