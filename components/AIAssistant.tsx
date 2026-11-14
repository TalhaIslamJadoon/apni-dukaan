"use client";

import { useEffect, useRef, useState } from "react";
import { answerQuery, chipsFor, Audience } from "@/lib/assistant";
import { getSessionAccount, useStaffSession } from "@/lib/store";

// ─────────────────────────────────────────────────────────────────────────────
// 🤖 AI ASSISTANT panel — role-aware, answers from the app's REAL local
// data via lib/assistant.ts (deterministic query engine, NOT a fake LLM).
// Opened from a TopBar button (staff) or a floating button on /online
// (customers). Renders its chat ONLY when opened, so POS screens never
// slow down. Audience comes from the staff session (owner/stock/kitchen/
// staff) — no staff session means a customer.
// ─────────────────────────────────────────────────────────────────────────────

interface Msg { from: "user" | "bot"; text: string }

function audienceOf(member: ReturnType<typeof useStaffSession>): Audience {
  if (!member) return "customer";
  if (member.isOwner || member.tabs.includes("owner")) return "owner";
  if (member.tabs.length === 1 && member.tabs[0] === "stock") return "stock";
  if (member.tabs.length === 1 && member.tabs[0] === "kitchen") return "kitchen";
  return "staff";
}

const ROLE_LABEL: Record<Audience, string> = {
  owner: "👑 Owner", staff: "🧑‍🍳 Staff", stock: "📦 Stock Keeper", kitchen: "👨‍🍳 Kitchen", customer: "🛍️ Customer",
};

export default function AIAssistant({ variant }: { variant: "topbar" | "floating" }) {
  const member = useStaffSession();
  const [open, setOpen] = useState(false);
  const audience = audienceOf(member);

  return (
    <>
      {variant === "topbar" ? (
        <button onClick={() => setOpen(true)} data-testid="ai-open"
          className="rounded-full px-3.5 py-1.5 text-xs font-extrabold text-white transition hover:brightness-125 active:scale-[0.98] shrink-0"
          style={{ background: "#7C3AED" }}>
          🤖 AI Assistant
        </button>
      ) : (
        <button onClick={() => setOpen(true)} data-testid="ai-open-floating" aria-label="AI Assistant"
          className="fixed bottom-24 right-4 z-40 w-14 h-14 rounded-full text-2xl text-white shadow-xl transition hover:brightness-125 active:scale-95"
          style={{ background: "#7C3AED" }}>
          🤖
        </button>
      )}
      {open && <AssistantDrawer audience={audience} memberName={member?.name} memberTabs={member?.tabs} onClose={() => setOpen(false)} />}
    </>
  );
}

function AssistantDrawer({ audience, memberName, memberTabs, onClose }: { audience: Audience; memberName?: string; memberTabs?: string[]; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const account = typeof window !== "undefined" ? getSessionAccount() : null;

  useEffect(() => {
    setMsgs([{ from: "bot", text: `👋 Salam${memberName ? `, ${memberName}` : ""}! Mein aapka POS assistant hoon.\nSystem ke asal data se jawab deta hoon — product, stock, orders jo bhi poochna hai likhein, ya neeche ke sawal chunein.` }]);
  }, [memberName]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [msgs]);

  function ask(text: string) {
    const t = text.trim();
    if (!t) return;
    const reply = answerQuery(t, {
      audience,
      memberName,
      staffTabs: memberTabs,
      customerMobile: account?.mobile,
      customerName: account?.name,
    });
    setMsgs((m) => [...m, { from: "user", text: t }, { from: "bot", text: reply }]);
    setInput("");
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="AI Assistant">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white w-full max-w-[400px] h-full flex flex-col shadow-2xl pop-in" data-testid="ai-drawer">
        <div className="flex items-center gap-2 px-4 py-3 text-white shrink-0" style={{ background: "#7C3AED" }}>
          <span className="text-2xl">🤖</span>
          <div className="flex-1 min-w-0">
            <div className="font-black leading-tight">AI Assistant</div>
            <div className="text-xs opacity-85">{ROLE_LABEL[audience]} mode · system ke asal data se jawab</div>
          </div>
          <button onClick={onClose} className="text-2xl font-bold opacity-80 hover:opacity-100" aria-label="Close assistant">✕</button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-auto p-3 space-y-2 bg-[#F5F3FF]">
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.from === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-line shadow-sm ${m.from === "user" ? "text-white" : "bg-white"}`}
                style={m.from === "user" ? { background: "#7C3AED" } : undefined}>
                {m.text}
              </div>
            </div>
          ))}
        </div>

        <div className="px-3 pt-2 shrink-0">
          <div className="flex gap-1.5 flex-wrap" data-testid="ai-chips">
            {chipsFor(audience).map((c) => (
              <button key={c} onClick={() => ask(c)} className="rounded-full border-2 px-3 py-1.5 text-xs font-bold bg-white transition hover:bg-violet-50 active:scale-[0.98]" style={{ borderColor: "#DDD6FE", color: "#6D28D9" }}>
                {c}
              </button>
            ))}
          </div>
        </div>

        <form className="p-3 flex gap-2 shrink-0" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} data-testid="ai-input"
            placeholder="Sawal likhein… (e.g. Surf Excel ki price?)"
            className="flex-1 rounded-xl border-2 border-stone-200 px-3.5 py-2.5 outline-none focus:border-violet-500" />
          <button type="submit" className="rounded-xl px-4 py-2.5 font-extrabold text-white active:scale-[0.98]" style={{ background: "#7C3AED" }}>Send</button>
        </form>
        <p className="px-3 pb-3 text-[11px] text-stone-400 shrink-0">Abhi ye assistant system ke data se jawab deta hai; asal AI (Gemini) Phase 2 mein lagega.</p>
      </div>
    </div>
  );
}
