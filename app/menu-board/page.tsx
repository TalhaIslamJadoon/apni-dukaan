"use client";

// ─────────────────────────────────────────────────────────────────────────────
// 📺 CANTEEN MENU BOARD (/menu-board) — KFC-style digital menu TV for the
// canteen front. Slides advance every 10 seconds on their own, looping
// forever: a "🎁 Aaj ki Deals" slide FIRST whenever an active deal exists,
// then the CANTEEN menu grouped
// by category. Talha's rule
// (15 Nov 2026): dono store ki screens ALAG hon — grocery (Offers slide +
// product slides by Head) lives on its own board at /grocery-board. All
// data comes from the LIVE store (same loadMenu() the POS + Owner use) —
// an owner price/name edit shows up on the next loop with no code change.
// DEAL CARDS (Talha, 15 Nov 2026, phone screenshot): a deal card shows
// WHAT IS INSIDE the deal — every component with its real photo, full
// name and ×qty — the deal name in FULL (wraps, never cut), contents
// value struck + deal price big in the footer. Deal cards are TALLER
// than photo cards, so the deals slide has its OWN capacity (dealCapacity:
// max 2 rows, whole cards only — a card never hangs half off the screen).
// FULL NAMES EVERYWHERE (Talha, same day): no name on any board is cut
// with an ellipsis — names wrap (up to 2 lines) instead.
// VIEW-ONLY: no PIN, no staff login — but staff CAN drive the loop
// manually (Talha, 15 Nov 2026): a fading bottom-left control bar
// (⏮ Pichli · ⏸ Rokain/▶ Chalayein · ⏭ Agli) plus keyboard — Space =
// pause/resume, ←/→ = prev/next. While paused a "⏸ Ruki Hui" chip
// stays on screen and the progress bar freezes.
//
// TESTING AID: ?sec=2 shortens the slide interval (default stays 10s).
// CAPACITY (Talha): NO fixed items-per-slide. The board measures the
// screen and fits as many readable cards as the screen holds — columns by
// viewport width (big TV ≈ 4, medium ≈ 3, small/portrait ≈ 2), rows by
// available height (landscape TV = 2) — items-per-slide = cols × rows,
// recomputed on resize. A group with more items than one slide holds is
// split into parts ("Fast Food (2/2)" style headers).
// PHOTOS: the item's own image, emoji art when there is no photo (or it
// fails to load).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CATEGORIES, CATEGORY_STYLE, Deal, MenuItem, loadMenu, loadDeals, dealComponents, dealValue, useShop,
} from "@/lib/store";
import { CanteenOnly } from "@/components/BusinessGate";

// One component inside a deal card: real photo, full name, ×qty.
interface BoardComp { name: string; qty: number; image?: string; emoji: string }

// One card model for a menu-board slide (canteen menu item or deal).
interface BoardItem {
  id: string;
  name: string;
  price: number;
  priceSuffix?: string;
  valuePrice?: number; // deal cards: contents value, shown struck-through
  components?: BoardComp[]; // deal cards: what's INSIDE the deal
  image?: string;
  emoji: string;
  chip: string; // corner label (category name)
  chipBg: string;
  cardBg: string; // photo-area background
}

interface Slide { key: string; title: string; deals?: boolean; items: BoardItem[]; part: number; parts: number }

// Columns from width, rows from height — the bigger the screen, the more
// cards per slide; cards stay distance-readable because fewer, larger
// cards are used on small screens instead of squeezing.
function boardCapacity(w: number, h: number): { cols: number; rows: number; per: number } {
  const cols = w >= 1600 ? 4 : w >= 1100 ? 3 : 2;
  const rows = h > w ? 3 : h >= 560 ? 2 : 1;
  return { cols, rows, per: cols * rows };
}

// DEAL-slide capacity: a deal card lists its contents (photo + name + qty
// per component), so its cell must be TALLER than a photo card's. At most
// 2 rows, and only 1 row when the screen is short — the slide always
// shows WHOLE cards (Talha's phone screenshot had a third card hanging
// half off the bottom under the old shared capacity).
function dealCapacity(w: number, h: number): { cols: number; rows: number; per: number } {
  const cols = w >= 1600 ? 4 : w >= 1100 ? 3 : 2;
  const rows = h > w ? (h >= 680 ? 2 : 1) : h >= 560 ? 2 : 1;
  return { cols, rows, per: cols * rows };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildSlides(menu: MenuItem[], deals: Deal[], per: number, dealPer: number): Slide[] {
  const slides: Slide[] = [];
  // 🎁 Deals FIRST (Talha): when at least one ACTIVE deal has contents,
  // its slide(s) open the rotation — the card lists the deal's contents
  // (photo + name + ×qty per component), deal price BIG, value struck.
  // Chunked by the DEAL capacity (taller cells), not the photo capacity.
  const dealCards: BoardItem[] = deals
    .filter((d) => d.active)
    .map((d) => {
      const value = dealValue(d, menu);
      if (value <= 0) return null; // every component deleted — nothing to show
      const card: BoardItem = {
        id: `deal:${d.id}`, name: d.name, price: d.price,
        components: dealComponents(d, menu).map((c) => ({ name: c.item.name, qty: c.qty, image: c.item.image, emoji: c.item.emoji })),
        emoji: "🎁", chip: "🎁 DEAL", chipBg: "#DC2626", cardBg: "#FEF2F2",
      };
      if (value > d.price) card.valuePrice = value;
      return card;
    })
    .filter((c): c is BoardItem => c !== null);
  if (dealCards.length) {
    const groups = chunk(dealCards, dealPer);
    groups.forEach((gItems, i) => slides.push({ key: `deals-${i}`, title: "🎁 Aaj ki Deals", deals: true, items: gItems, part: i + 1, parts: groups.length }));
  }
  // Canteen menu ONLY, category by category (grocery is /grocery-board).
  const canteen = menu.filter((m) => m.mode !== "grocery");
  for (const cat of CATEGORIES) {
    const items = canteen.filter((m) => m.category === cat);
    if (!items.length) continue;
    const style = CATEGORY_STYLE[cat];
    const cards: BoardItem[] = items.map((m) => ({
      id: m.id, name: m.name, price: m.price, image: m.image, emoji: m.emoji,
      chip: style.label, chipBg: style.chip, cardBg: style.bg,
    }));
    const groups = chunk(cards, per);
    groups.forEach((gItems, i) => slides.push({ key: `${cat}-${i}`, title: cat, items: gItems, part: i + 1, parts: groups.length }));
  }
  return slides;
}

function ItemCard({ item }: { item: BoardItem }) {
  const [imgOk, setImgOk] = useState(true);
  const showImg = Boolean(item.image) && imgOk;
  return (
    <div className="rounded-3xl overflow-hidden bg-white flex flex-col min-h-0"
      style={{ boxShadow: "0 10px 26px rgba(0,0,0,0.45)" }}>
      <div className="relative flex-1 min-h-0" style={{ background: item.cardBg }}>
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
          style={{ background: item.chipBg, fontSize: "clamp(0.7rem, 1.1vw, 1rem)" }}>
          {item.chip}
        </span>
      </div>
      <div className="px-4 sm:px-5 py-3 sm:py-4 shrink-0">
        {/* FULL name on its own full-width lines (up to 3) — the price sits
            on the row BELOW, so a long name is never squeezed into an
            ellipsis by the price next to it (Talha, 15 Nov 2026). */}
        <div className="font-black leading-tight line-clamp-3" style={{ color: "#0F172A", fontSize: "clamp(0.95rem, 1.9vw, 1.85rem)" }}>
          {item.name}
        </div>
        <div className="flex items-end justify-between gap-3 mt-1">
          {item.valuePrice !== undefined ? (
            <s className="font-extrabold leading-none" style={{ color: "#A8A29E", fontSize: "clamp(0.9rem, 1.5vw, 1.4rem)" }}>
              Rs {item.valuePrice}
            </s>
          ) : <span />}
          <div className="font-black whitespace-nowrap leading-tight" style={{ color: item.valuePrice !== undefined ? "#DC2626" : "#F97316", fontSize: "clamp(1.25rem, 2.3vw, 2.2rem)" }}>
            Rs {item.price}{item.priceSuffix ?? ""}
          </div>
        </div>
      </div>
    </div>
  );
}

// Component thumbnail on a deal card — the item's real photo, its emoji
// when there is no photo (or the photo fails to load).
function CompThumb({ comp, small, sizeOverride }: { comp: BoardComp; small?: boolean; sizeOverride?: string }) {
  const [imgOk, setImgOk] = useState(true);
  const size = small ? "1.55rem" : (sizeOverride ?? "clamp(2.6rem, 4vw, 4.2rem)");
  return (
    <span className={`shrink-0 overflow-hidden flex items-center justify-center ${small ? "rounded-lg" : "rounded-2xl"}`}
      style={{ width: size, height: size, background: "#FFF7ED", fontSize: small ? "0.95rem" : "clamp(1.4rem, 2.4vw, 2.4rem)" }}>
      {comp.image && imgOk ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={comp.image} alt="" onError={() => setImgOk(false)} className="w-full h-full object-cover" />
      ) : comp.emoji}
    </span>
  );
}

const MAX_BOARD_COMPONENTS = 5;

// 🎁 DEAL CARD — the deal's name in FULL on top, then WHAT IS INSIDE:
// one row per component (photo + full name + ×qty), then the footer with
// the contents value struck through and the deal price BIG. Rows stretch
// to fill the card (flex-1) so there is no giant empty gift-box area.
// COMPACT mode (narrow cards, e.g. a phone in portrait): the badge sits
// next to the name, the ×qty pill rides on the thumbnail, and the type
// shrinks — so even a long component name still fits in full (up to 3
// wrapped lines) instead of being squeezed out by TV-sized minimums.
function DealCard({ item, compact }: { item: BoardItem; compact?: boolean }) {
  const comps = item.components ?? [];
  // A deal with MORE than 4 components shows the first 4 + a "+N aur"
  // line: 5 squeezed rows physically overlap inside a board card (the
  // rows are flex-1 in a fixed-height grid cell), 4 always fit cleanly.
  const shown = comps.length > 4 ? comps.slice(0, 4) : comps.slice(0, MAX_BOARD_COMPONENTS);
  const extra = comps.length - shown.length;
  const dense = !compact && shown.length >= 4;
  const padX = compact ? "px-3" : "px-4 sm:px-5";
  return (
    <div className="rounded-3xl overflow-hidden bg-white flex flex-col min-h-0" data-testid="board-deal-card" data-name={item.name}
      style={{ boxShadow: "0 10px 26px rgba(0,0,0,0.45)" }}>
      {/* Header — DEAL badge + full deal name (wraps up to 2 lines) */}
      {compact ? (
        <div className={`shrink-0 ${padX} pt-2.5 pb-2`} style={{ background: item.cardBg }}>
          <span className="inline-block rounded-full px-2 py-0.5 font-black text-white"
            style={{ background: item.chipBg, fontSize: "0.6rem" }}>
            {item.chip}
          </span>
          {/* Name gets the FULL card width (badge on its own line above) —
              side-by-side it was squeezed into an ellipsis. */}
          <div className="font-black leading-tight line-clamp-3 mt-1" style={{ color: "#0F172A", fontSize: "0.82rem" }}>
            {item.name}
          </div>
        </div>
      ) : (
        <div className={`shrink-0 ${padX} pt-3 sm:pt-4 pb-2.5`} style={{ background: item.cardBg }}>
          <span className="inline-block rounded-full px-3 py-1 font-black text-white"
            style={{ background: item.chipBg, fontSize: "clamp(0.7rem, 1.1vw, 1rem)" }}>
            {item.chip}
          </span>
          <div className="font-black leading-tight line-clamp-2 mt-1.5" style={{ color: "#0F172A", fontSize: "clamp(1.3rem, 2.3vw, 2.2rem)" }}>
            {item.name}
          </div>
        </div>
      )}
      {/* Contents — har cheez: pic + poora naam + ×qty */}
      <div className={`flex-1 min-h-0 flex flex-col ${padX} py-1.5`}>
        {shown.map((c, i) => (
          <div key={i} data-testid="board-deal-comp" data-name={c.name}
            className={`flex-1 min-h-0 flex items-center py-1 ${compact ? "gap-2" : "gap-3"}`}
            style={i > 0 ? { borderTop: "2px dashed #F5F5F4" } : undefined}>
            {compact ? (
              <span className="relative shrink-0">
                <CompThumb comp={c} small />
                <span className="absolute -bottom-1.5 -right-1.5 font-black rounded-full px-1.5 py-px text-white"
                  style={{ background: "#0F172A", fontSize: "0.6rem", border: "1.5px solid #fff" }}>
                  ×{c.qty}
                </span>
              </span>
            ) : (
              <CompThumb comp={c} sizeOverride={dense ? "2.8rem" : undefined} />
            )}
            <span className={`flex-1 min-w-0 font-extrabold leading-tight ${compact || !dense ? "line-clamp-3" : "line-clamp-2"}`}
              style={{ color: "#44403C", fontSize: compact ? "0.65rem" : dense ? "clamp(0.85rem, 1.3vw, 1.25rem)" : "clamp(0.95rem, 1.45vw, 1.4rem)" }}>
              {c.name}
            </span>
            {!compact && (
              <span className="shrink-0 font-black rounded-full px-2.5 py-1 text-white"
                style={{ background: "#0F172A", fontSize: "clamp(0.85rem, 1.4vw, 1.35rem)" }}>
                ×{c.qty}
              </span>
            )}
          </div>
        ))}
        {extra > 0 && (
          <div className="shrink-0 font-bold py-1" style={{ color: "#A8A29E", fontSize: compact ? "0.65rem" : "clamp(0.8rem, 1.2vw, 1.1rem)" }}>
            +{extra} aur cheezein bhi shamil hain
          </div>
        )}
      </div>
      {/* Footer — kul qeemat kati hui, deal price bari */}
      <div className={`shrink-0 flex items-end justify-between gap-3 ${padX} ${compact ? "py-2" : "py-3"}`}
        style={{ borderTop: "3px dashed #FECACA", background: "#FFF7ED" }}>
        <div className="min-w-0">
          {!compact && (
            <div className="font-bold leading-tight" style={{ color: "#A8A29E", fontSize: "clamp(0.7rem, 1.1vw, 1rem)" }}>
              Deal mein sab shamil
            </div>
          )}
          {item.valuePrice !== undefined && (
            <s className="font-extrabold leading-tight" style={{ color: "#A8A29E", fontSize: compact ? "0.8rem" : "clamp(1rem, 1.7vw, 1.6rem)" }}>
              Rs {item.valuePrice}
            </s>
          )}
        </div>
        <div className="font-black whitespace-nowrap leading-none" style={{ color: "#DC2626", fontSize: compact ? "1.3rem" : "clamp(1.7rem, 3vw, 2.9rem)" }}>
          Rs {item.price}
        </div>
      </div>
    </div>
  );
}

function MenuBoard() {
  const shop = useShop();
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [idx, setIdx] = useState(0);
  const [sec, setSec] = useState(10);
  const [clock, setClock] = useState(() => new Date());
  const [showExit, setShowExit] = useState(true);
  const [paused, setPaused] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [cycle, setCycle] = useState(0); // bumped on any manual move / pause toggle — restarts the progress animation
  const [view, setView] = useState(() => (typeof window !== "undefined" ? { w: window.innerWidth, h: window.innerHeight } : { w: 1920, h: 1080 }));
  const dataJsonRef = useRef("");

  // Slide interval (?sec= — testing aid only; shipped default is 10)
  useEffect(() => {
    const s = Number(new URLSearchParams(window.location.search).get("sec"));
    if (s >= 1 && s <= 60) setSec(s);
  }, []);

  // Screen size — slides rebuild whenever the TV/window is resized.
  useEffect(() => {
    const onResize = () => setView({ w: window.innerWidth, h: window.innerHeight });
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Live data: storage event (owner tab edits) + 2s poll — the same store
  // the POS screens read, so price/name edits land on the next loop.
  useEffect(() => {
    const read = () => {
      const m = loadMenu();
      const d = loadDeals();
      const j = JSON.stringify([m, d]);
      if (j !== dataJsonRef.current) {
        dataJsonRef.current = j;
        setMenu(m);
        setDeals(d);
      }
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

  const cap = boardCapacity(view.w, view.h);
  const dealCap = dealCapacity(view.w, view.h);
  const slides = useMemo(() => buildSlides(menu, deals, cap.per, dealCap.per), [menu, deals, cap.per, dealCap.per]);
  const safeIdx = slides.length ? idx % slides.length : 0;
  const slide = slides[safeIdx];

  // Manual navigation — wraps around the ends; the rotation effect keys
  // off safeIdx, so a manual move while playing restarts the interval
  // from the new slide, and while paused the slide just changes and
  // STAYS paused.
  const goTo = (n: number) => {
    if (!slides.length) return;
    setIdx(((n % slides.length) + slides.length) % slides.length);
    setCycle((c) => c + 1);
  };
  const goNext = () => goTo(safeIdx + 1);
  const goPrev = () => goTo(safeIdx - 1);
  const togglePause = () => { setPaused((p) => !p); setCycle((c) => c + 1); };

  // Auto-rotate: advance every `sec`, looping forever — never while paused.
  useEffect(() => {
    if (paused || slides.length < 2) return;
    const t = setInterval(() => setIdx((safeIdx + 1) % slides.length), sec * 1000);
    return () => clearInterval(t);
  }, [slides.length, sec, paused, safeIdx]);

  // Controls + exit auto-fade; mouse move / touch brings them back
  // (control bar ~3s, exit ~4s). The paused chip never fades.
  useEffect(() => {
    let tC: ReturnType<typeof setTimeout>;
    let tE: ReturnType<typeof setTimeout>;
    const wake = () => {
      setShowControls(true); setShowExit(true);
      clearTimeout(tC); clearTimeout(tE);
      tC = setTimeout(() => setShowControls(false), 3000);
      tE = setTimeout(() => setShowExit(false), 4000);
    };
    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("touchstart", wake);
    return () => { clearTimeout(tC); clearTimeout(tE); window.removeEventListener("mousemove", wake); window.removeEventListener("touchstart", wake); };
  }, []);

  // Keyboard: Space = pause/resume, → = next, ← = previous.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.code === "Space") { e.preventDefault(); togglePause(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); goNext(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Grid shape for THIS slide: never more columns than the screen's
  // capacity, and only as many rows as the slide's cards actually need.
  // DEALS slides use the deal grid (dealCap cols × rows — taller cells,
  // whole cards only); the grid keeps the full deal shape even when a
  // slide holds fewer deals, so cards never stretch into empty giants.
  const isDeals = !!slide?.deals;
  const cols = !slide ? cap.cols : isDeals ? dealCap.cols : Math.min(cap.cols, Math.max(slide.items.length, 1));
  const rows = !slide ? 1 : isDeals ? dealCap.rows : Math.max(1, Math.ceil(slide.items.length / cols));

  return (
    <div className="h-dvh flex flex-col text-white select-none overflow-hidden" style={{ background: "#0F172A" }}>
      {/* Header — shop name + clock (shop name wraps in full, never cut) */}
      <header className="flex items-center gap-4 px-6 sm:px-10 pt-5 pb-3 shrink-0">
        <div className="text-4xl sm:text-5xl">🏪</div>
        <div className="flex-1 min-w-0">
          <div className="font-black leading-tight line-clamp-2" style={{ fontSize: "clamp(1.6rem, 3.6vw, 3rem)" }}>
            {shop.canteenName}
            <span className="ml-4 font-extrabold hidden min-[500px]:inline" style={{ color: "#F97316", fontSize: "0.62em" }}>MENU</span>
          </div>
          {shop.collegeName && (
            <div className="opacity-60 font-bold line-clamp-2 mt-0.5" style={{ fontSize: "clamp(0.8rem, 1.2vw, 1.05rem)" }}>{shop.collegeName}</div>
          )}
        </div>
        <div className="font-black tabular-nums shrink-0" style={{ color: "#F97316", fontSize: "clamp(1.3rem, 2.6vw, 2.4rem)" }}>
          {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </header>

      {slide ? (
        <main key={`${slide.key}-${dataJsonRef.current.length}`} className="fade-slide flex-1 flex flex-col min-h-0 px-4 sm:px-8 pb-4">
          {/* Slide banner */}
          <div className="flex items-end gap-4 shrink-0 pb-3">
            <h2 data-testid="slide-title" className="font-black leading-none text-white" style={{ fontSize: "clamp(2rem, 4.6vw, 4.2rem)" }}>
              {slide.title}
            </h2>
            {slide.parts > 1 && (
              <span className="font-black rounded-full px-4 py-1 mb-2" style={{ background: "#F97316", fontSize: "clamp(0.85rem, 1.3vw, 1.2rem)" }}>
                {slide.part} / {slide.parts}
              </span>
            )}
            <span className="flex-1 mb-3 hidden sm:block" style={{ borderTop: "3px dashed rgba(255,255,255,0.25)" }} />
            <span data-testid="slide-pos" className="font-bold opacity-60 mb-1.5 shrink-0" style={{ fontSize: "clamp(0.85rem, 1.3vw, 1.2rem)" }}>
              Slide {safeIdx + 1} of {slides.length}
            </span>
          </div>

          {/* Item cards — grid sized by the measured screen capacity */}
          <div className="flex-1 min-h-0 grid gap-4 sm:gap-5"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
            {slide.items.map((item) => isDeals
              ? <DealCard key={item.id} item={item} compact={(view.w - 40) / Math.max(cols, 1) < 300} />
              : <ItemCard key={item.id} item={item} />)}
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
            <div key={`${safeIdx}-${cycle}`} className="h-full rounded-full"
              style={{ background: "#F97316", animation: `progressGrow ${sec}s linear forwards`, animationPlayState: paused ? "paused" : "running" }} />
          )}
        </div>
        <div className="flex justify-center gap-2 mt-3">
          {slides.map((s, i) => (
            <span key={s.key} className="rounded-full transition-all"
              style={{ width: i === safeIdx ? 26 : 10, height: 10, background: i === safeIdx ? "#F97316" : "rgba(255,255,255,0.35)" }} />
          ))}
        </div>
      </footer>

      {/* Manual controls — bottom-left cluster: the bar fades after ~3s
          idle; the "Ruki Hui" chip stays for as long as the board is paused. */}
      <div className="fixed bottom-3 left-3 z-50 flex flex-col items-start gap-2">
        <div data-testid="board-controls" className="flex items-center gap-2 transition-opacity duration-700"
          style={{ opacity: showControls ? 1 : 0, pointerEvents: showControls ? "auto" : "none" }}>
          <button data-testid="ctl-prev" aria-label="Pichli slide"
            onClick={(e) => { goPrev(); e.currentTarget.blur(); }}
            className="rounded-full px-4 py-2 text-sm font-extrabold text-white"
            style={{ background: "rgba(15,23,42,0.78)", border: "1px solid rgba(255,255,255,0.4)", backdropFilter: "blur(4px)" }}>
            ⏮ Pichli
          </button>
          <button data-testid="ctl-toggle" aria-label={paused ? "Chalayein" : "Rokain"}
            onClick={(e) => { togglePause(); e.currentTarget.blur(); }}
            className="rounded-full px-4 py-2 text-sm font-extrabold text-white"
            style={{ background: paused ? "rgba(22,163,74,0.9)" : "rgba(15,23,42,0.78)", border: "1px solid rgba(255,255,255,0.4)", backdropFilter: "blur(4px)" }}>
            {paused ? "▶ Chalayein" : "⏸ Rokain"}
          </button>
          <button data-testid="ctl-next" aria-label="Agli slide"
            onClick={(e) => { goNext(); e.currentTarget.blur(); }}
            className="rounded-full px-4 py-2 text-sm font-extrabold text-white"
            style={{ background: "rgba(15,23,42,0.78)", border: "1px solid rgba(255,255,255,0.4)", backdropFilter: "blur(4px)" }}>
            ⏭ Agli
          </button>
        </div>
        {paused && (
          <div data-testid="paused-chip" className="rounded-full px-4 py-2 text-sm font-extrabold text-white"
            style={{ background: "rgba(245,158,11,0.92)", boxShadow: "0 4px 14px rgba(0,0,0,0.4)" }}>
            ⏸ Ruki Hui
          </div>
        )}
      </div>

      {/* Exit — tiny corner control, auto-fades */}
      <button onClick={() => window.close()} aria-label="Band karein"
        className="fixed bottom-3 right-3 z-50 rounded-full px-4 py-2 text-sm font-extrabold text-white transition-opacity duration-700"
        style={{ background: "rgba(220,38,38,0.9)", opacity: showExit ? 0.85 : 0 }}>
        ✕ Band karein
      </button>
    </div>
  );
}

// Business gate (SALE version): ye screen sirf tab chalti hai jab us ki
// dukaan business setup mein ON ho — warna polite notice.
export default function MenuBoardPage() {
  return (
    <CanteenOnly what="Canteen Menu Board">
      <MenuBoard />
    </CanteenOnly>
  );
}
