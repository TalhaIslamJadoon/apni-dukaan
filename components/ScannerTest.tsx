"use client";

// ── Scanner Test ─────────────────────────────────────────────────────────────
// Device Setup rule (Talha): barcode scanner lagana bhi system ke andar se
// asaan ho — koi driver/setting nahi, bas USB lagao aur yahan test kar lo.
// Panel khulte hi scanner ki har "typing" (burst) pakri jati hai; code pehle
// local catalogue mein (packing barcode → product barcode → SKU, counter
// wali tarteeb), na mile to server lookup. Nateeja simple alfaz mein:
//   mila     → badi sabz "✅ Scanner chal raha hai — [product]"
//   na mila  → amber "Scanner ne parh liya hai lekin ye cheez system mein
//              nahi" — ye bhi scanner ke CHALNE ka saboot hai, is liye
//              wording yehi rakhi hai (ghalti scanner ki nahi, product add
//              karna baqi hai).
// 30 second tak koi scan na aye to USB wali hidayat khud aa jati hai.
import { useEffect, useRef, useState } from "react";
import { loadGrocery } from "@/lib/store";
import { apiGet } from "@/lib/api";

type Result =
  | { kind: "found"; name: string }
  | { kind: "unknown"; code: string };

function beep(ok: boolean) {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = ok ? 880 : 520;
    gain.gain.value = 0.08;
    osc.start();
    osc.stop(ctx.currentTime + 0.09);
    osc.onended = () => { ctx.close().catch(() => {}); };
  } catch { /* ignore */ }
}

export default function ScannerTest() {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [waitedLong, setWaitedLong] = useState(false);
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const testRef = useRef<(raw: string) => void>(() => {});
  testRef.current = (raw: string) => { void test(raw); };

  // 30s tak koi scan na aye to USB hidayat — timer har scan par reset.
  useEffect(() => {
    setWaitedLong(false);
    const id = setTimeout(() => setWaitedLong(true), 30000);
    return () => clearTimeout(id);
  }, [result]);

  // Page-level burst listener (grocery counter wali discipline): focus kisi
  // field mein ho to typing chhor do — apna input khud Enter par test karta
  // hai; focus kahin aur ho to burst yahan pakro.
  useEffect(() => {
    let buf = "";
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const now = performance.now();
      if (now - last > 60) buf = "";
      last = now;
      if (e.key === "Enter") {
        if (buf.length >= 3) testRef.current(buf);
        buf = "";
      } else if (e.key.length === 1) {
        buf += e.key;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function test(raw: string) {
    const c = raw.trim();
    if (!c || checking) return;
    setChecking(true);
    try {
      const items = loadGrocery();
      for (const it of items) {
        for (const v of it.variants ?? []) {
          if (v.packings.some((k) => k.barcode && k.barcode === c)) {
            setResult({ kind: "found", name: it.name }); beep(true); return;
          }
        }
      }
      const local = items.find((it) => it.barcode && it.barcode === c) || items.find((it) => it.sku === c);
      if (local) { setResult({ kind: "found", name: local.name }); beep(true); return; }
      // Local na mile to server lookup (wahi counter wali tarteeb wahan bhi).
      try {
        const r = await apiGet<{ item?: { name?: string } }>(`/staff/grocery/lookup?code=${encodeURIComponent(c)}`);
        if (r.item?.name) { setResult({ kind: "found", name: r.item.name }); beep(true); return; }
      } catch { /* server par bhi nahi — unknown hi hai */ }
      setResult({ kind: "unknown", code: c });
      beep(true); // scanner ne PARHA hai — awaaz kamyabi ki hi hai
    } finally {
      setChecking(false);
      setCode("");
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }

  return (
    <div className="rounded-2xl border-2 border-dashed border-stone-200 p-3" data-testid="scanner-test">
      <div className="font-extrabold mb-1">🔫 Scanner Test — scanner se kisi bhi cheez ka barcode scan karein</div>
      <p className="text-sm text-stone-500 mb-3">
        Scanner ki USB taang PC mein lagayein — <b>koi setting nahi hoti</b>. Phir kisi bhi product ka barcode scan karke dekhein.
        Code haath se likh kar bhi test kar sakte hain:
      </p>
      <form
        onSubmit={(e) => { e.preventDefault(); void test(code); }}
        className="flex gap-2 mb-3"
      >
        <input
          ref={inputRef}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Barcode scan karein ya code likh kar Enter"
          data-testid="scanner-test-input"
          className="rounded-xl border-2 border-stone-200 px-3 py-2.5 flex-1 min-w-[170px] outline-none focus:border-orange-500"
        />
        <button type="submit" disabled={checking} className="rounded-xl px-4 py-2.5 font-extrabold text-white disabled:opacity-60" style={{ background: "#0F172A" }}>
          {checking ? "Check…" : "Test"}
        </button>
      </form>
      {result?.kind === "found" && (
        <div className="rounded-2xl px-4 py-3 font-black text-white text-lg" style={{ background: "#16A34A" }} data-testid="scanner-test-found">
          ✅ Scanner chal raha hai — {result.name}
        </div>
      )}
      {result?.kind === "unknown" && (
        <div className="rounded-2xl px-4 py-3 font-bold text-white" style={{ background: "#D97706" }} data-testid="scanner-test-unknown">
          🟠 Scanner ne parh liya hai (code: {result.code}) — lekin ye cheez system mein nahi hai.
          Scanner bilkul theek hai; pehle ye product add karein, phir ye scan bill mein jayega.
        </div>
      )}
      {!result && (
        <p className="text-sm font-semibold text-stone-500">
          ⏳ Scanner ke scan ka intezar hai…
          {waitedLong && <span className="block mt-1" style={{ color: "#D97706" }}>Abhi tak koi scan nahi aya — scanner ki USB taang check karein. Scanner lagate hi chal jata hai, koi setting nahi hoti.</span>}
        </p>
      )}
      {result && (
        <button onClick={() => { setResult(null); inputRef.current?.focus(); }} className="mt-2 text-sm font-bold underline text-stone-500">
          Dobara test karein
        </button>
      )}
    </div>
  );
}
