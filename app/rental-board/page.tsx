"use client";

// ─────────────────────────────────────────────────────────────────────────────
// 📺 RENTAL / DRESS BOARD (/rental-board) — dukaan ki TV screen jis par
// rent wali dresses bari bari nazar ati hain (Talha, 17–18 Nov 2026).
// Baqi boards wala hi pattern: 10s rotation, ⏮/⏸/⏭ controls + keyboard,
// screen ke size se capacity (whole cards only), Board ka Rang theme +
// auto contrast, koi login nahi.
// SLIDES: pehle "🎉 Aaj ki Offers" (jin dresses par offer chal raha hai —
// asal kiraya kata hua, offer kiraya BARA laal pill mein), phir saari
// dresses "👗 Rent ke liye Dresses" slides mein. Available dress normal
// card; booked/bahar gayi dress par gehra "📅 BOOKED" ribbon (customer
// ko dikhta hai ke dress mashhoor hai, bas abhi li gayi hai); cleaning /
// inactive dresses board par NAHI atin.
// "GHUMTA HUA" VIEW (Talha: "3D view mein ghumtay hue" — asal 3D model
// maujood nahi, is liye photo-spin): dress ki photos zyada hon to card
// un par ghoomta hai — 8+ photos = tez 900ms spin (bilkul 360° jaisa),
// 2–7 photos = 2.5s crossfade turntable, 1 photo = slow Ken Burns zoom.
// Offers slide ke cards par halki si 3D sway (rotateY ±4°) bhi hai.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import {
  RENTAL_CATEGORIES, RentalItem, loadRentalItems, rentalAvailableQty, rentalCategoryEmoji, rentalOfferActive, rentalPhotos, useShop,
} from "@/lib/store";
import { RentalsOnly } from "@/components/BusinessGate";

interface Slide { key: string; title: string; offers?: boolean; items: RentalItem[]; part: number; parts: number }

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

// ── Board theme — baqi boards wala hi (owner ka chuna Board ka Rang) ──
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

function buildSlides(items: RentalItem[], per: number): Slide[] {
  const visible = items.filter((i) => i.status === "available" || i.status === "booked" || i.status === "out");
  const slides: Slide[] = [];
  // 🎉 Offers slide FIRST (grocery board parity) — sirf woh dresses jin
  // par offer ASAL mein active hai.
  const offers = visible.filter((i) => rentalOfferActive(i));
  if (offers.length) {
    const groups = chunk(offers, per);
    groups.forEach((gItems, i) => slides.push({ key: `offers-${i}`, title: "🎉 Aaj ki Offers", offers: true, items: gItems, part: i + 1, parts: groups.length }));
  }
  // Phir har CATEGORY (function) ki apni slides — "💍 Baraat Collection",
  // "💡 Lights Collection" waghera; bina category wale aakhir mein.
  const catOrder: string[] = [];
  for (const c of RENTAL_CATEGORIES) if (visible.some((i) => i.category === c)) catOrder.push(c);
  for (const i of visible) if (i.category && !catOrder.includes(i.category)) catOrder.push(i.category);
  for (const cat of catOrder) {
    const groups = chunk(visible.filter((i) => i.category === cat), per);
    groups.forEach((gItems, i) => slides.push({
      key: `cat-${cat}-${i}`, title: `${rentalCategoryEmoji(cat)} ${cat} Collection`,
      items: gItems, part: i + 1, parts: groups.length,
    }));
  }
  const noCat = visible.filter((i) => !i.category);
  if (noCat.length) {
    const groups = chunk(noCat, per);
    groups.forEach((gItems, i) => slides.push({ key: `all-${i}`, title: "👗 Rent ke liye Dresses", items: gItems, part: i + 1, parts: groups.length }));
  }
  return slides;
}

// Dress ki photo(s) — ghumta hua view:
//  • 8+ photos → tez spin (~900ms/photo, halki crossfade) = 360° feel
//  • 2–7 photos → 2.5s crossfade turntable
//  • 1 photo → slow Ken Burns zoom/pan
//  • 0 photo → emoji art
function PhotoCycle({ item, taken }: { item: RentalItem; taken: boolean }) {
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const photos = rentalPhotos(item);
  const valid = photos.filter((u) => !failed[u]);
  const [idx, setIdx] = useState(0);
  const spin = valid.length >= 8;
  const interval = spin ? 900 : 2500;
  useEffect(() => {
    if (valid.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % valid.length), interval);
    return () => clearInterval(t);
  }, [valid.length, interval]);

  if (!valid.length) {
    return (
      <div className="absolute inset-0 flex items-center justify-center" style={{ fontSize: "clamp(3.5rem, 7vw, 7.5rem)", filter: taken ? "grayscale(0.4) brightness(0.8)" : undefined }}>
        {item.emoji}
      </div>
    );
  }
  if (valid.length === 1) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={valid[0]} alt={item.name} onError={() => setFailed((f) => ({ ...f, [valid[0]]: true }))}
        className="ken-burns absolute inset-0 w-full h-full object-cover"
        style={{ filter: taken ? "brightness(0.75)" : undefined }} />
    );
  }
  const cur = idx % valid.length;
  return (
    <div data-testid="photo-cycle" data-photos={valid.length} data-spin={spin ? "fast" : "slow"}>
      {valid.map((u, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={u} src={u} alt={i === cur ? item.name : ""} onError={() => setFailed((f) => ({ ...f, [u]: true }))}
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            opacity: i === cur ? 1 : 0,
            transform: i === cur ? "scale(1.04)" : "scale(1)",
            transition: spin ? "opacity 180ms linear, transform 900ms linear" : "opacity 900ms ease, transform 2500ms ease",
            filter: taken ? "brightness(0.75)" : undefined,
          }} />
      ))}
      {spin ? (
        <span className="absolute bottom-3 right-3 rounded-full px-3 py-1 font-black text-white" style={{ background: "rgba(15,23,42,0.8)", fontSize: "clamp(0.7rem, 1.1vw, 1rem)" }}>
          🔄 360°
        </span>
      ) : (
        <span className="absolute bottom-3 right-3 flex gap-1.5">
          {valid.map((u, i) => (
            <span key={u} className="rounded-full" style={{ width: i === cur ? 18 : 8, height: 8, background: i === cur ? "#fff" : "rgba(255,255,255,0.5)", boxShadow: "0 1px 4px rgba(0,0,0,0.5)", transition: "all 300ms" }} />
          ))}
        </span>
      )}
    </div>
  );
}

function DressCard({ item, theme, offerSlide }: { item: RentalItem; theme: BoardTheme; offerSlide?: boolean }) {
  // Taken = dress book ho chuki, YA qty wale samaan ke saare piece gaye hue.
  const availQty = rentalAvailableQty(item);
  const taken = item.status === "booked" || item.status === "out" || (availQty <= 0 && (item.bookedQty ?? 0) > 0);
  const offer = rentalOfferActive(item);
  const price = offer ? (item.offerRentPerDay as number) : item.rentPerDay;
  return (
    <div data-testid="dress-card" data-name={item.name} data-status={item.status}
      className={`rounded-3xl overflow-hidden bg-white flex flex-col min-h-0 ${offerSlide ? "board-sway" : ""}`}
      style={{ boxShadow: theme.cardShadow }}>
      <div className="relative min-h-0" style={{ background: "#FFF7ED", flex: "0 1 58%" }}>
        <PhotoCycle item={item} taken={taken} />
        {offer ? (
          <span className="absolute top-3 left-3 rounded-full px-3 py-1 font-black text-white z-10"
            style={{ background: "#DC2626", fontSize: "clamp(0.7rem, 1.1vw, 1rem)" }}>
            🎉 OFFER
          </span>
        ) : !taken ? (
          <span className="absolute top-3 left-3 rounded-full px-3 py-1 font-black text-white z-10"
            style={{ background: "#16A34A", fontSize: "clamp(0.7rem, 1.1vw, 1rem)" }}>
            ✅ AVAILABLE
          </span>
        ) : null}
        {taken && (
          <span data-testid="booked-ribbon" className="absolute z-10 font-black text-white text-center"
            style={{
              top: "1.6rem", right: "-2.6rem", width: "11rem", transform: "rotate(38deg)",
              background: "#0F172A", padding: "0.35rem 0", letterSpacing: "0.08em",
              fontSize: "clamp(0.75rem, 1.2vw, 1.05rem)", boxShadow: "0 6px 16px rgba(0,0,0,0.45)",
            }}>
            📅 BOOKED
          </span>
        )}
      </div>
      <div className="px-4 sm:px-5 py-3 sm:py-4" style={{ flex: "1 1 auto" }}>
        {/* FULL name — kabhi cut nahi (2-3 lines wrap) */}
        <div className="font-black leading-tight line-clamp-3" style={{ color: "#0F172A", fontSize: "clamp(0.95rem, 1.9vw, 1.85rem)" }}>
          {item.name}
        </div>
        <div className="font-bold mt-0.5" style={{ color: "#78716C", fontSize: "clamp(0.8rem, 1.3vw, 1.2rem)" }}>
          {[item.size ? `Size ${item.size}` : "", item.color ?? ""].filter(Boolean).join(" · ") || " "}
        </div>
        {(item.totalQty || 1) > 1 && !taken && (
          <div className="font-black mt-0.5" style={{ color: "#16A34A", fontSize: "clamp(0.8rem, 1.3vw, 1.2rem)" }}>
            📦 Sirf {availQty} piece bache
          </div>
        )}
        <div className="flex items-end justify-between gap-3 mt-1.5">
          {offer ? (
            <s className="font-extrabold leading-none" style={{ color: "#A8A29E", fontSize: "clamp(0.9rem, 1.5vw, 1.4rem)" }}>
              Rs {item.rentPerDay}
            </s>
          ) : <span />}
          <div className="text-right">
            <div className="font-black whitespace-nowrap leading-none rounded-full px-4 py-2 text-white inline-block"
              style={{ background: offer ? "#DC2626" : "#F97316", fontSize: "clamp(1.5rem, 2.8vw, 2.7rem)", boxShadow: "0 6px 14px rgba(146,90,0,0.35)" }}>
              Rs {price}
            </div>
            <div className="font-extrabold mt-1" style={{ color: "#78716C", fontSize: "clamp(0.75rem, 1.2vw, 1.1rem)" }}>
              per din · Security Rs {item.securityDeposit.toLocaleString()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RentalBoard() {
  const shop = useShop();
  const theme = boardTheme(shop.boardColor ?? "#FFC61A");
  const [items, setItems] = useState<RentalItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [sec, setSec] = useState(10);
  const [clock, setClock] = useState(() => new Date());
  const [showExit, setShowExit] = useState(true);
  const [paused, setPaused] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [cycle, setCycle] = useState(0);
  const [view, setView] = useState(() => (typeof window !== "undefined" ? { w: window.innerWidth, h: window.innerHeight } : { w: 1920, h: 1080 }));
  const dataJsonRef = useRef("");

  useEffect(() => {
    const s = Number(new URLSearchParams(window.location.search).get("sec"));
    if (s >= 1 && s <= 60) setSec(s);
  }, []);

  useEffect(() => {
    const onResize = () => setView({ w: window.innerWidth, h: window.innerHeight });
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Live data: rentals-changed / storage events + 2s poll (boards pattern).
  useEffect(() => {
    const read = () => {
      const list = loadRentalItems();
      const j = JSON.stringify(list);
      if (j !== dataJsonRef.current) {
        dataJsonRef.current = j;
        setItems(list);
      }
    };
    read();
    const t = setInterval(read, 2000);
    window.addEventListener("storage", read);
    window.addEventListener("rentals-changed", read);
    return () => { clearInterval(t); window.removeEventListener("storage", read); window.removeEventListener("rentals-changed", read); };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const cap = boardCapacity(view.w, view.h);
  const slides = useMemo(() => buildSlides(items, cap.per), [items, cap.per]);
  const safeIdx = slides.length ? idx % slides.length : 0;
  const slide = slides[safeIdx];

  const goTo = (n: number) => {
    if (!slides.length) return;
    setIdx(((n % slides.length) + slides.length) % slides.length);
    setCycle((c) => c + 1);
  };
  const goNext = () => goTo(safeIdx + 1);
  const goPrev = () => goTo(safeIdx - 1);
  const togglePause = () => { setPaused((p) => !p); setCycle((c) => c + 1); };

  useEffect(() => {
    if (paused || slides.length < 2) return;
    const t = setInterval(() => setIdx((safeIdx + 1) % slides.length), sec * 1000);
    return () => clearInterval(t);
  }, [slides.length, sec, paused, safeIdx]);

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

  const cols = !slide ? cap.cols : Math.min(cap.cols, Math.max(slide.items.length, 1));
  const rows = !slide ? 1 : Math.max(1, Math.ceil(slide.items.length / cols));

  return (
    <div className="h-dvh flex flex-col select-none overflow-hidden" style={{ background: theme.bg, color: theme.ink }} data-testid="rental-board">
      <header className="flex items-center gap-4 px-6 sm:px-10 pt-5 pb-3 shrink-0">
        <div className="shrink-0 flex items-center justify-center rounded-full" style={{ width: "clamp(3rem, 5vw, 4.6rem)", height: "clamp(3rem, 5vw, 4.6rem)", background: theme.badgeBg, fontSize: "clamp(1.5rem, 2.6vw, 2.4rem)", boxShadow: "0 6px 16px rgba(0,0,0,0.3)" }}>👰</div>
        <div className="flex-1 min-w-0">
          <div className="font-black leading-tight line-clamp-2" style={{ fontSize: "clamp(1.6rem, 3.6vw, 3rem)" }}>
            {shop.groceryName}
            <span className="ml-4 font-extrabold hidden min-[500px]:inline-block rounded-full px-3 py-1 align-middle" style={{ background: theme.chipBg, color: theme.chipColor, fontSize: "0.5em" }}>RENT</span>
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

          <div className="flex-1 min-h-0 grid gap-4 sm:gap-5"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
            {slide.items.map((item) => (
              <DressCard key={item.id} item={item} theme={theme} offerSlide={slide.offers} />
            ))}
          </div>
        </main>
      ) : (
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-7xl mb-4">👗</div>
            <div className="font-black text-3xl">Dresses jald arahi hain…</div>
            <div className="font-bold mt-2" style={{ color: theme.subInk }}>Rent ke liye dresses add hon to yahan nazar ayengi</div>
          </div>
        </main>
      )}

      <footer className="shrink-0 px-6 sm:px-10 pb-5">
        <div className="h-2 rounded-full overflow-hidden" style={{ background: theme.trackBg }}>
          {slides.length > 1 && (
            <div key={`${safeIdx}-${cycle}`} className="h-full rounded-full"
              style={{ background: theme.fill, animation: `progressGrow ${sec}s linear forwards`, animationPlayState: paused ? "paused" : "running" }} />
          )}
        </div>
        <div className="flex justify-center gap-2 mt-3">
          {slides.map((s, i) => (
            <span key={s.key} className="rounded-full transition-all"
              style={{ width: i === safeIdx ? 26 : 10, height: 10, background: i === safeIdx ? theme.fill : theme.dotOff }} />
          ))}
        </div>
      </footer>

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

      <button onClick={() => window.close()} aria-label="Band karein"
        className="fixed bottom-3 right-3 z-50 rounded-full px-4 py-2 text-sm font-extrabold text-white transition-opacity duration-700"
        style={{ background: "rgba(220,38,38,0.9)", opacity: showExit ? 0.85 : 0 }}>
        ✕ Band karein
      </button>
    </div>
  );
}

// Business gate: board sirf tab chalti hai jab Kiraya wala kaam ON ho —
// warna baqi boards jaisi polite notice.
export default function RentalBoardPage() {
  return (
    <RentalsOnly what="Dress Board">
      <RentalBoard />
    </RentalsOnly>
  );
}
