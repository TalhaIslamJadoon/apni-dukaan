"use client";

// ─────────────────────────────────────────────────────────────────────────────
// 🧺 GROCERY BOARD (/grocery-board) — KFC-style digital board TV for the
// grocery store front. Talha's rule (15 Nov 2026): dono store ki screens
// ALAG hon — this board is GROCERY ONLY; the canteen menu lives on
// /menu-board. Slides advance every 10 seconds on their own, looping
// forever. FIRST in the loop (when the owner has flagged any) come the
// "🎉 Aaj ki Offers" slides — products with boardOffer set in Owner
// Dashboard → Grocery Products. A flagged product with a REAL offer
// price (owner-set, and charged at the till too) shows BOTH rates —
// retail struck through, offer price big; without one it shows plain
// retail. Then ALL grocery products, grouped
// by Main Head (sub-head order kept inside each head). All data comes
// from the LIVE store (same loadGrocery() the POS + Owner use) — an owner
// price/flag edit shows up on the next loop with no code change.
// VIEW-ONLY: no PIN, no staff login — but staff CAN drive the loop
// manually (Talha, 15 Nov 2026): a fading bottom-left control bar
// (⏮ Pichli · ⏸ Rokain/▶ Chalayein · ⏭ Agli) plus keyboard — Space =
// pause/resume, ←/→ = prev/next. While paused a "⏸ Ruki Hui" chip
// stays on screen and the progress bar freezes.
//
// TESTING AID: ?sec=2 shortens the slide interval (default stays 10s).
// CAPACITY (Talha): NO fixed items-per-slide — same rule as /menu-board.
// The board measures the screen and fits as many readable cards as the
// screen holds (cols by width, rows by height), recomputed on resize. A
// head with more products than one slide holds is split into parts.
// PHOTOS: product ki apni photos PhotoCycle par ghumti hain (rental
// board wala system — 8+ = tez 900ms spin, 2–7 = 2.5s turntable, 1 =
// Ken Burns); apni photo na ho to product → sub-head → head fallback
// chain (groceryImage) ki single photo, emoji art jab kuch bhi na ho.
// BOARD THEME (Talha, 16 Nov 2026 — "Munch O Clock" wali photo dekh kar,
// phir usi din ki tabdeeli: rang hard-coded NAHI): board ka background
// rang OWNER chunta hai (Owner → Settings → 🎨 Board ka Rang; default
// photo wala peela #FFC61A). Photo-forward white cards, price ek bari
// orange pill mein (offer price red pill, purani retail kati hui chhoti),
// offers slide ka title dark tag mein (photo ke "DEAL STATION" ribbon
// jaisa). Text ka contrast rang ki roshni (HSP) se KHUD banta hai —
// halka rang → dark slate text wala bright look, gehra rang → white
// text wala purana dark look. Sirf visual layer hai — rotation,
// capacity, controls sab pehle jaisa.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import {
  GroceryHead, GroceryItem, GrocerySubHead,
  effectiveRetail, groceryImage, itemPhotos, loadGrocery, loadGroceryHeads, loadGrocerySubHeads, offerActive, useShop,
} from "@/lib/store";
import { RetailOnly } from "@/components/BusinessGate";
import PhotoCycle from "@/components/PhotoCycle";

const OFFERS_TITLE = "🎉 Aaj ki Offers — Grocery";

// Chip colours cycle per head — dark enough to read on the pastel cards.
const HEAD_CHIP_COLORS = ["#B45309", "#1D4ED8", "#15803D", "#BE185D", "#7C3AED", "#0E7490", "#A16207", "#C2410C"];

interface BoardItem {
  id: string;
  name: string;
  sub?: string; // packing sizes line, e.g. "500g · 1kg · 2kg"
  price: number;
  oldPrice?: number; // offers slide only: retail struck through above the offer price
  priceSuffix?: string; // "/kg" for loose items
  image?: string;
  photos?: string[]; // product ki apni photos (multi ho to card ghumta hai); apni photo na ho to fallback chain ki single photo
  emoji: string;
  chip: string; // corner label (sub-head name, or "🎉 Offer")
  chipBg: string;
  cardBg: string; // photo-area background
}

interface Slide { key: string; title: string; offers?: boolean; items: BoardItem[]; part: number; parts: number }

// Columns from width, rows from height — the bigger the screen, the more
// cards per slide (same capacity rule as /menu-board).
function boardCapacity(w: number, h: number): { cols: number; rows: number; per: number } {
  const cols = w >= 1600 ? 4 : w >= 1100 ? 3 : 2;
  const rows = h > w ? 3 : h >= 560 ? 2 : 1;
  return { cols, rows, per: cols * rows };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── Board theme — owner ke chune hue rang se (upar wala note dekhein) ──
interface BoardTheme {
  bg: string; ink: string; subInk: string; badgeBg: string;
  chipBg: string; chipColor: string; clockBg: string; clockColor: string;
  heroBg: string; heroColor: string; divider: string; trackBg: string;
  fill: string; dotOff: string; pausedBg: string; pausedColor: string;
  cardShadow: string;
}

function boardTheme(hex: string): BoardTheme {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  const n = m ? parseInt(m[1], 16) : 0xffc61a;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const base = `rgb(${r},${g},${b})`;
  const mixW = (a: number) => `rgb(${Math.round(r + (255 - r) * a)},${Math.round(g + (255 - g) * a)},${Math.round(b + (255 - b) * a)})`;
  const mixB = (a: number) => `rgb(${Math.round(r * (1 - a))},${Math.round(g * (1 - a))},${Math.round(b * (1 - a))})`;
  // HSP perceived brightness — 0.5 se upar = halka rang.
  const hsp = Math.sqrt(0.299 * r * r + 0.587 * g * g + 0.114 * b * b) / 255;
  if (hsp > 0.5) {
    return {
      bg: `linear-gradient(165deg, ${mixW(0.18)} 0%, ${base} 48%, ${mixB(0.07)} 100%)`,
      ink: "#0F172A", subInk: "rgba(15,23,42,0.62)", badgeBg: "#0F172A",
      chipBg: "#0F172A", chipColor: base, clockBg: "rgba(255,255,255,0.55)", clockColor: "#0F172A",
      heroBg: "#0F172A", heroColor: base, divider: "rgba(15,23,42,0.3)", trackBg: "rgba(15,23,42,0.18)",
      fill: "#0F172A", dotOff: "rgba(15,23,42,0.28)", pausedBg: "#0F172A", pausedColor: "#FBBF24",
      cardShadow: "0 12px 28px rgba(0,0,0,0.25)",
    };
  }
  return {
    bg: `linear-gradient(165deg, ${base} 0%, ${mixB(0.3)} 100%)`,
    ink: "#FFFFFF", subInk: "rgba(255,255,255,0.62)", badgeBg: "rgba(255,255,255,0.16)",
    chipBg: "#F97316", chipColor: "#FFFFFF", clockBg: "rgba(255,255,255,0.14)", clockColor: "#FFFFFF",
    heroBg: "#F97316", heroColor: "#FFFFFF", divider: "rgba(255,255,255,0.25)", trackBg: "rgba(255,255,255,0.15)",
    fill: "#F97316", dotOff: "rgba(255,255,255,0.35)", pausedBg: "rgba(245,158,11,0.92)", pausedColor: "#FFFFFF",
    cardShadow: "0 10px 26px rgba(0,0,0,0.45)",
  };
}

function packingLine(g: GroceryItem): string | undefined {
  if (!g.packings || !g.packings.length) return undefined;
  const labels = g.packings.slice(0, 3).map((p) => p.label);
  return labels.join(" · ") + (g.packings.length > 3 ? " …" : "");
}

function buildSlides(grocery: GroceryItem[], heads: GroceryHead[], subs: GrocerySubHead[], per: number): Slide[] {
  const slides: Slide[] = [];
  const subName = new Map(subs.map((s) => [s.id, s.name]));
  // Offers cards (offersMode) price at effectiveRetail: an ACTIVE offer
  // price replaces the representative retail, which is then kept as
  // oldPrice for the struck-through display. Head slides keep plain retail.
  const toCard = (g: GroceryItem, chip: string, chipBg: string, cardBg: string, offersMode = false): BoardItem => {
    // Photo-spin sirf product ki APNI photos par: images[] hon to wohi
    // ghumti hain; apni photo bilkul na ho to fallback chain (sub → head)
    // ki ek photo Ken Burns par rehti hai — kisi aur product ki photo
    // spin mein nahi milti.
    const own = itemPhotos(g);
    const fallback = groceryImage(g, heads, subs);
    return {
      id: g.id, name: g.name, sub: packingLine(g),
      price: offersMode ? effectiveRetail(g) : g.retailPrice,
      oldPrice: offersMode && offerActive(g) ? g.retailPrice : undefined,
      priceSuffix: g.unit === "kg" ? "/kg" : undefined,
      image: fallback, photos: own.length ? own : (fallback ? [fallback] : []), emoji: g.emoji, chip, chipBg, cardBg,
    };
  };

  // Offers FIRST — only when at least one product is flagged.
  const offers = grocery.filter((g) => g.boardOffer === true);
  if (offers.length) {
    const cards = offers.map((g) => toCard(g, "🎉 Offer", "#DC2626", "#FFF7ED", true));
    const groups = chunk(cards, per);
    groups.forEach((items, i) => slides.push({ key: `offers-${i}`, title: OFFERS_TITLE, offers: true, items, part: i + 1, parts: groups.length }));
  }

  // Then every product, Head by Head (sub-head order inside the head).
  heads.forEach((head, hi) => {
    const headSubs = subs.filter((s) => s.headId === head.id);
    const ordered: GroceryItem[] = [];
    for (const s of headSubs) ordered.push(...grocery.filter((g) => g.headId === head.id && g.subId === s.id));
    // Safety: any product whose sub is missing from the list still shows.
    for (const g of grocery) if (g.headId === head.id && !headSubs.some((s) => s.id === g.subId)) ordered.push(g);
    if (!ordered.length) return;
    const chipBg = HEAD_CHIP_COLORS[hi % HEAD_CHIP_COLORS.length];
    const cards = ordered.map((g) => toCard(g, subName.get(g.subId) ?? head.name, chipBg, head.tint));
    const groups = chunk(cards, per);
    groups.forEach((items, i) => slides.push({
      key: `${head.id}-${i}`, title: `${head.emoji} ${head.name}`, items, part: i + 1, parts: groups.length,
    }));
  });
  return slides;
}

function ItemCard({ item, theme }: { item: BoardItem; theme: BoardTheme }) {
  return (
    <div className="rounded-3xl overflow-hidden bg-white flex flex-col min-h-0"
      style={{ boxShadow: theme.cardShadow }}>
      <div className="relative min-h-0" style={{ background: item.cardBg, flex: "0 1 58%" }}>
        <PhotoCycle photos={item.photos ?? (item.image ? [item.image] : [])} name={item.name} emoji={item.emoji} />
        <span className="absolute top-3 left-3 rounded-full px-3 py-1 font-black text-white"
          style={{ background: item.chipBg, fontSize: "clamp(0.7rem, 1.1vw, 1rem)" }}>
          {item.chip}
        </span>
      </div>
      <div className="px-4 sm:px-5 py-3 sm:py-4" style={{ flex: "1 1 auto" }}>
        {/* FULL name on its own full-width lines (up to 3) — the price sits
            on the row BELOW, so a long name is never squeezed into an
            ellipsis by the price next to it (Talha, 15 Nov 2026). */}
        <div className="font-black leading-tight line-clamp-3" style={{ color: "#0F172A", fontSize: "clamp(0.95rem, 1.9vw, 1.85rem)" }}>
          {item.name}
        </div>
        {item.sub && (
          <div className="font-bold leading-snug line-clamp-2 mt-0.5" style={{ color: "#78716C", fontSize: "clamp(0.75rem, 1.2vw, 1.05rem)" }}>
            {item.sub}
          </div>
        )}
        <div className="flex items-end justify-between gap-3 mt-1.5">
          {item.oldPrice !== undefined ? (
            <div className="font-bold whitespace-nowrap line-through" style={{ color: "#A8A29E", fontSize: "clamp(0.9rem, 1.5vw, 1.4rem)" }}>
              Rs {item.oldPrice}{item.priceSuffix ?? ""}
            </div>
          ) : <span />}
          <div className="font-black whitespace-nowrap leading-none rounded-full px-4 py-2 text-white"
            style={{ background: item.oldPrice !== undefined ? "#DC2626" : "#F97316", fontSize: "clamp(1.5rem, 2.8vw, 2.7rem)", boxShadow: "0 6px 14px rgba(146,90,0,0.35)" }}>
            Rs {item.price}{item.priceSuffix ?? ""}
          </div>
        </div>
      </div>
    </div>
  );
}

function GroceryBoard() {
  const shop = useShop();
  const theme = boardTheme(shop.boardColor ?? "#FFC61A");
  const [grocery, setGrocery] = useState<GroceryItem[]>([]);
  const [heads, setHeads] = useState<GroceryHead[]>([]);
  const [subs, setSubs] = useState<GrocerySubHead[]>([]);
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

  // Live data: storage event (owner tab edits) + 2s poll — price/flag
  // edits land on the next loop, exactly like /menu-board.
  useEffect(() => {
    const read = () => {
      const g = loadGrocery(); const hs = loadGroceryHeads(); const ss = loadGrocerySubHeads();
      const j = JSON.stringify([g, hs, ss]);
      if (j !== dataJsonRef.current) {
        dataJsonRef.current = j;
        setGrocery(g); setHeads(hs); setSubs(ss);
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
  const slides = useMemo(() => buildSlides(grocery, heads, subs, cap.per), [grocery, heads, subs, cap.per]);
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
  const cols = slide ? Math.min(cap.cols, Math.max(slide.items.length, 1)) : cap.cols;
  const rows = slide ? Math.max(1, Math.ceil(slide.items.length / cols)) : 1;

  return (
    <div className="h-dvh flex flex-col select-none overflow-hidden" style={{ background: theme.bg, color: theme.ink }}>
      {/* Header — circular logo badge + grocery shop name + clock,
          photo ke boards ki tarah (name wraps in full) */}
      <header className="flex items-center gap-4 px-6 sm:px-10 pt-5 pb-3 shrink-0">
        <div className="shrink-0 flex items-center justify-center rounded-full" style={{ width: "clamp(3rem, 5vw, 4.6rem)", height: "clamp(3rem, 5vw, 4.6rem)", background: theme.badgeBg, fontSize: "clamp(1.5rem, 2.6vw, 2.4rem)", boxShadow: "0 6px 16px rgba(0,0,0,0.3)" }}>🛒</div>
        <div className="flex-1 min-w-0">
          <div className="font-black leading-tight line-clamp-2" style={{ fontSize: "clamp(1.6rem, 3.6vw, 3rem)" }}>
            {shop.groceryName}
            <span className="ml-4 font-extrabold hidden min-[500px]:inline-block rounded-full px-3 py-1 align-middle" style={{ background: theme.chipBg, color: theme.chipColor, fontSize: "0.5em" }}>{slide?.offers ? "OFFERS" : "GROCERY"}</span>
          </div>
          {shop.collegeName && (
            <div className="font-bold line-clamp-2 mt-0.5" style={{ color: theme.subInk, fontSize: "clamp(0.8rem, 1.2vw, 1.05rem)" }}>{shop.collegeName}</div>
          )}
        </div>
        <div className="font-black tabular-nums shrink-0 rounded-full px-4 py-1" style={{ background: theme.clockBg, color: theme.clockColor, fontSize: "clamp(1.3rem, 2.6vw, 2.4rem)" }}>
          {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </header>

      {slide ? (
        <main key={`${slide.key}-${dataJsonRef.current.length}`} className="fade-slide flex-1 flex flex-col min-h-0 px-4 sm:px-8 pb-4">
          {/* Slide banner — offers slide ka title dark tag mein (photo ke
              "DEAL STATION" ribbon jaisa), baqi slides ka title bara dark */}
          <div className="flex items-end gap-4 shrink-0 pb-3">
            {slide.offers ? (
              <h2 data-testid="slide-title" className="font-black leading-none rounded-3xl px-6 py-3" style={{ background: theme.heroBg, color: theme.heroColor, fontSize: "clamp(1.7rem, 4vw, 3.6rem)", boxShadow: "0 8px 20px rgba(0,0,0,0.3)" }}>
                {slide.title}
              </h2>
            ) : (
              <h2 data-testid="slide-title" className="font-black leading-none" style={{ color: theme.ink, fontSize: "clamp(2rem, 4.6vw, 4.2rem)" }}>
                {slide.title}
              </h2>
            )}
            {slide.parts > 1 && (
              <span className="font-black rounded-full px-4 py-1 mb-2" style={{ background: theme.chipBg, color: theme.chipColor, fontSize: "clamp(0.85rem, 1.3vw, 1.2rem)" }}>
                {slide.part} / {slide.parts}
              </span>
            )}
            <span className="flex-1 mb-3 hidden sm:block" style={{ borderTop: `3px dashed ${theme.divider}` }} />
            <span data-testid="slide-pos" className="font-bold mb-1.5 shrink-0" style={{ color: theme.subInk, fontSize: "clamp(0.85rem, 1.3vw, 1.2rem)" }}>
              Slide {safeIdx + 1} of {slides.length}
            </span>
          </div>

          {/* Item cards — grid sized by the measured screen capacity */}
          <div className="flex-1 min-h-0 grid gap-4 sm:gap-5"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
            {slide.items.map((item) => <ItemCard key={item.id} item={item} theme={theme} />)}
          </div>
        </main>
      ) : (
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-7xl mb-4">🧺</div>
            <div className="font-black text-3xl">Grocery board jald araha hai…</div>
          </div>
        </main>
      )}

      {/* Progress bar + dots — position inside the loop */}
      <footer className="shrink-0 px-6 sm:px-10 pb-5">
        <div className="h-2 rounded-full overflow-hidden" style={{ background: theme.trackBg }}>
          {slides.length > 1 && (
            <div key={`${safeIdx}-${cycle}`} className="h-full rounded-full"
              style={{ background: theme.fill, animation: `progressGrow ${sec}s linear forwards`, animationPlayState: paused ? "paused" : "running" }} />
          )}
        </div>
        {/* Dots only when the loop is short enough for them to mean
            something — the grocery loop has dozens of slides, where the
            banner's "Slide X of N" is the honest position indicator. */}
        {slides.length <= 20 && (
          <div className="flex justify-center gap-2 mt-3 flex-wrap">
            {slides.map((s, i) => (
              <span key={s.key} className="rounded-full transition-all"
                style={{ width: i === safeIdx ? 26 : 10, height: 10, background: i === safeIdx ? theme.fill : theme.dotOff }} />
            ))}
          </div>
        )}
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
          <div data-testid="paused-chip" className="rounded-full px-4 py-2 text-sm font-extrabold"
            style={{ background: theme.pausedBg, color: theme.pausedColor, boxShadow: "0 4px 14px rgba(0,0,0,0.4)" }}>
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
export default function GroceryBoardPage() {
  return (
    <RetailOnly what="Products Board">
      <GroceryBoard />
    </RetailOnly>
  );
}
