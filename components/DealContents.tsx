"use client";

// ─────────────────────────────────────────────────────────────────────────────
// 🎁 DEAL KE ANDAR KI CHEEZEIN — compact component rows shared by the
// Canteen POS deal tile and the Online deal card (the Menu Board has its
// own large-format version). Talha (15 Nov 2026): "Deal mein jo cheezein
// hum add karein wo deal ke andar show hon — unki pic sath, quantity
// likhi ho udhar hi." Har component: real photo (warna emoji), POORA
// naam (wraps, kabhi cut nahi) aur ×qty. Zyada components hon to pehle
// MAX dikhte hain, baqi "+N aur cheezein" line mein.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { Deal, MenuItem, dealComponents } from "@/lib/store";

export const MAX_DEAL_ROWS = 4;

function Thumb({ item, size }: { item: MenuItem; size: number }) {
  const [imgOk, setImgOk] = useState(true);
  return (
    <span className="shrink-0 rounded-xl overflow-hidden flex items-center justify-center bg-white shadow-sm"
      style={{ width: size, height: size, fontSize: size * 0.52 }}>
      {item.image && imgOk ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.image} alt="" loading="lazy" onError={() => setImgOk(false)} className="w-full h-full object-cover" />
      ) : item.emoji}
    </span>
  );
}

export default function DealContentsRows({ deal, menu, thumb = 34 }: { deal: Deal; menu: MenuItem[]; thumb?: number }) {
  const comps = dealComponents(deal, menu);
  const shown = comps.slice(0, MAX_DEAL_ROWS);
  const extra = comps.length - shown.length;
  return (
    <div className="mt-2 space-y-1" data-testid="deal-contents">
      {shown.map((c) => (
        <div key={c.item.id} className="flex items-center gap-2" data-testid="deal-comp-row" data-name={c.item.name}>
          <Thumb item={c.item} size={thumb} />
          <span className="flex-1 min-w-0 font-bold leading-tight text-[13px] text-stone-700">{c.item.name}</span>
          <span className="shrink-0 font-black text-xs rounded-full px-2 py-0.5 text-white" style={{ background: "#0F172A" }}>×{c.qty}</span>
        </div>
      ))}
      {extra > 0 && (
        <div className="text-[11px] font-bold text-stone-400">+{extra} aur cheezein bhi shamil</div>
      )}
    </div>
  );
}
