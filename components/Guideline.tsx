"use client";

import { useEffect, useState } from "react";
import { GUIDELINES, GUIDELINE_KEYS, type GuidelineKey } from "@/lib/guidelines";

type GuidelineView =
  | { kind: "entry"; key: GuidelineKey; fromIndex: boolean }
  | { kind: "index" };

interface GuidelineButtonProps {
  entry: GuidelineKey;
  label?: string;
  variant?: "topbar" | "section" | "floating";
  className?: string;
}

const BUTTON_CLASSES: Record<NonNullable<GuidelineButtonProps["variant"]>, string> = {
  topbar:
    "rounded-full px-3.5 py-1.5 text-xs font-extrabold text-white transition hover:brightness-125 active:scale-[0.98] shrink-0 shadow",
  section:
    "rounded-xl px-3.5 py-2 text-sm font-extrabold text-white transition hover:brightness-110 active:scale-[0.98] shrink-0 shadow-sm",
  floating:
    "fixed bottom-24 left-3 sm:left-4 z-40 rounded-full px-4 py-3 text-sm font-extrabold text-white shadow-xl transition hover:brightness-110 active:scale-95",
};

export function GuidelineButton({
  entry,
  label = "📖 Guideline",
  variant = "section",
  className = "",
}: GuidelineButtonProps) {
  const [view, setView] = useState<GuidelineView | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => setView({ kind: "entry", key: entry, fromIndex: false })}
        data-testid={`guideline-open-${entry}`}
        className={`${BUTTON_CLASSES[variant]} ${className}`}
        style={{ background: "#F97316" }}
      >
        {label}
      </button>
      {view && <GuidelineModal view={view} onViewChange={setView} onClose={() => setView(null)} />}
    </>
  );
}

export function GuidelineIndexButton({ className = "" }: { className?: string }) {
  const [view, setView] = useState<GuidelineView | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => setView({ kind: "index" })}
        data-testid="guideline-open-index"
        className={`rounded-xl px-4 py-2.5 text-sm font-extrabold text-white transition hover:brightness-110 active:scale-[0.98] shadow ${className}`}
        style={{ background: "#F97316" }}
      >
        📖 Saari Guidelines
      </button>
      {view && <GuidelineModal view={view} onViewChange={setView} onClose={() => setView(null)} />}
    </>
  );
}

function GuidelineModal({
  view,
  onViewChange,
  onClose,
}: {
  view: GuidelineView;
  onViewChange: (view: GuidelineView) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const entry = view.kind === "entry" ? GUIDELINES[view.key] : null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Guideline">
      <button type="button" aria-label="Guideline band karein" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="pop-in relative flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden bg-white shadow-2xl sm:rounded-3xl rounded-t-3xl" data-testid="guideline-modal">
        <div className="flex items-start gap-3 px-4 py-3.5 text-white shrink-0" style={{ background: "#0F172A" }}>
          <span className="text-3xl" aria-hidden="true">📖</span>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-black leading-tight">
              {view.kind === "index" ? "Saari Guidelines" : entry?.title}
            </div>
            <div className="text-xs font-bold text-stone-300">
              {view.kind === "index"
                ? "Jo tab chahiye us ki guideline chunein — step-by-step tareeqa khul jayega."
                : "Isi screen ka roz ka kaam, sahi order mein."}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="guideline-close"
            aria-label="Close guideline"
            className="rounded-full bg-white/10 px-3 py-1.5 text-xl font-black leading-none transition hover:bg-white/20"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto bg-[#FFF7ED] p-4">
          {view.kind === "index" ? (
            <GuidelineIndex onSelect={(key) => onViewChange({ kind: "entry", key, fromIndex: true })} />
          ) : entry ? (
            <div data-testid={`guideline-entry-${view.key}`}>
              {view.fromIndex && (
                <button
                  type="button"
                  onClick={() => onViewChange({ kind: "index" })}
                  data-testid="guideline-back-index"
                  className="mb-3 rounded-xl border-2 border-orange-200 bg-white px-3.5 py-2 text-sm font-extrabold text-stone-700 transition hover:bg-orange-50"
                >
                  ← Saari Guidelines
                </button>
              )}

              <ol className="space-y-2.5">
                {entry.steps.map((step, i) => (
                  <li key={i} className="flex gap-3 rounded-2xl border border-orange-100 bg-white p-3 shadow-sm">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-black text-white" style={{ background: "#F97316" }}>
                      {i + 1}
                    </span>
                    <span className="pt-0.5 text-[15px] font-semibold leading-relaxed text-stone-700">{step}</span>
                  </li>
                ))}
              </ol>

              {entry.tips && entry.tips.length > 0 && (
                <div className="mt-4 rounded-2xl border-2 border-amber-200 bg-amber-50 p-3.5">
                  <div className="mb-1.5 font-black" style={{ color: "#92400E" }}>💡 Dhyaan dein</div>
                  <ul className="list-disc space-y-1.5 pl-5 text-sm font-semibold leading-relaxed text-stone-700">
                    {entry.tips.map((tip, i) => <li key={i}>{tip}</li>)}
                  </ul>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function GuidelineIndex({ onSelect }: { onSelect: (key: GuidelineKey) => void }) {
  const staffKeys = GUIDELINE_KEYS.slice(0, 5);
  const ownerKeys = GUIDELINE_KEYS.slice(5);

  const renderButton = (key: GuidelineKey) => {
    const item = GUIDELINES[key];
    return (
      <button
        key={key}
        type="button"
        onClick={() => onSelect(key)}
        data-testid={`guideline-index-${key}`}
        className="rounded-2xl border-2 border-orange-100 bg-white p-3 text-left shadow-sm transition hover:border-orange-400 hover:bg-orange-50 active:scale-[0.99]"
      >
        <span className="block font-extrabold leading-snug text-stone-800">{item.title}</span>
        <span className="mt-1 block text-xs font-bold text-stone-400">{item.steps.length} steps · kholne ke liye dabayein →</span>
      </button>
    );
  };

  return (
    <div data-testid="guideline-index">
      <div className="mb-2 text-xs font-black uppercase tracking-widest text-stone-400">Staff aur Customer Tabs</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{staffKeys.map(renderButton)}</div>
      <div className="mb-2 mt-5 text-xs font-black uppercase tracking-widest text-stone-400">Owner Dashboard — Tabs Wise</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{ownerKeys.map(renderButton)}</div>
    </div>
  );
}

export default GuidelineButton;
