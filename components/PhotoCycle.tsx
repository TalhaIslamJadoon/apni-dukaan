"use client";

// ─────────────────────────────────────────────────────────────────────────────
// 🔄 PHOTO CYCLE — board cards ka "ghumta hua" photo view (rental board
// wala hi system, ab canteen menu + grocery boards par bhi — Talha,
// 18 Nov 2026: "ye system baqi shops aur canteen wali cheezon par bhi
// laga dena"):
//  • 8+ photos → tez spin (~900ms/photo, halki crossfade) = 360° feel
//  • 2–7 photos → 2.5s crossfade turntable
//  • 1 photo → slow Ken Burns zoom/pan
//  • 0 photo → emoji art
// Parent ko `relative` hona chahiye — photos absolute inset-0 par lagti
// hain. Jo photo load fail ho jaye wo khud list se nikal jati hai.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";

export default function PhotoCycle({ photos, name, emoji, dimmed }: {
  photos: string[];
  name: string;
  emoji: string;
  dimmed?: boolean; // rental board ke "taken" jaisa halka gehra rang
}) {
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const valid = photos.filter((u) => u && !failed[u]);
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
      <div className="absolute inset-0 flex items-center justify-center" style={{ fontSize: "clamp(3.5rem, 7vw, 7.5rem)", filter: dimmed ? "grayscale(0.4) brightness(0.8)" : undefined }}>
        {emoji}
      </div>
    );
  }
  if (valid.length === 1) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={valid[0]} alt={name} onError={() => setFailed((f) => ({ ...f, [valid[0]]: true }))}
        className="ken-burns absolute inset-0 w-full h-full object-cover"
        style={{ filter: dimmed ? "brightness(0.75)" : undefined }} />
    );
  }
  const cur = idx % valid.length;
  return (
    <div data-testid="photo-cycle" data-photos={valid.length} data-spin={spin ? "fast" : "slow"}>
      {valid.map((u, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={u} src={u} alt={i === cur ? name : ""} onError={() => setFailed((f) => ({ ...f, [u]: true }))}
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            opacity: i === cur ? 1 : 0,
            transform: i === cur ? "scale(1.04)" : "scale(1)",
            transition: spin ? "opacity 180ms linear, transform 900ms linear" : "opacity 900ms ease, transform 2500ms ease",
            filter: dimmed ? "brightness(0.75)" : undefined,
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
