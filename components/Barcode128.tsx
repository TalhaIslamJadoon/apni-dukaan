"use client";

import { code128Widths } from "@/lib/code128";

// Renders a real Code 128 (subset B) barcode as inline SVG — crisp at any
// print size, no images, no external assets. Quiet zones included.
export default function Barcode128({ value, height = 40 }: { value: string; height?: number }) {
  const widths = code128Widths(value || "0");
  const QUIET = 10; // modules of white on each side (scanner quiet zone)
  const total = widths.reduce((s, w) => s + w, 0) + QUIET * 2;
  let x = QUIET;
  const bars: { x: number; w: number }[] = [];
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, w }); // even runs are bars
    x += w;
  });
  return (
    <svg viewBox={`0 0 ${total} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label={`Barcode ${value}`} style={{ display: "block" }}>
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={height} fill="#000" />
      ))}
    </svg>
  );
}
