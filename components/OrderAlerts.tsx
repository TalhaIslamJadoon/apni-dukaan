"use client";

import { useEffect, useRef, useState } from "react";
import { loadOrders } from "@/lib/store";
import { AlertRole, OrderAlert, alertsFor, beep, speak } from "@/lib/alerts";

// ─────────────────────────────────────────────────────────────────────────────
// 🔔 Staff order-alert banner — mounted by each staff screen with its own
// role (Owner / Canteen / Grocery / Kitchen). Watches the orders store
// (poll ~3s + BroadcastChannel + storage + the store's change event, so a
// second tab of the same browser alerts near-instantly) and stacks a
// PERSISTENT banner for every new alert — it stays until the staff member
// taps "✓ Dekh Liya". While any alert is unacknowledged, the beep + voice
// announcement repeat every ~15 seconds (lib/alerts.ts). Seen keys live
// per role in sessionStorage, baseline-seeded on the first mount of the
// session so yesterday's / earlier orders never re-alert.
// ─────────────────────────────────────────────────────────────────────────────

export default function OrderAlerts({ role }: { role: AlertRole }) {
  const [alerts, setAlerts] = useState<OrderAlert[]>([]);
  const seenRef = useRef<Set<string> | null>(null);
  const activeRef = useRef<OrderAlert[]>([]);
  activeRef.current = alerts;

  useEffect(() => {
    const storeKey = `pos-alert-seen-v1-${role}`;
    const persist = () => {
      try { sessionStorage.setItem(storeKey, JSON.stringify([...(seenRef.current ?? [])])); } catch { /* ignore */ }
    };
    let first = true;
    const check = () => {
      const current = alertsFor(loadOrders(), role);
      if (!seenRef.current) {
        let stored: string[] | null = null;
        try { const raw = sessionStorage.getItem(storeKey); stored = raw ? (JSON.parse(raw) as string[]) : null; } catch { /* ignore */ }
        if (stored) {
          seenRef.current = new Set(stored);
        } else if (first) {
          // First mount of this session: everything already there is the
          // baseline — seed silently so old orders don't re-alert.
          seenRef.current = new Set(current.map((a) => a.key));
          persist();
          first = false;
          return;
        } else {
          seenRef.current = new Set();
        }
      }
      first = false;
      const seen = seenRef.current;
      const fresh = current.filter((a) => !seen.has(a.key) && !activeRef.current.some((x) => x.key === a.key));
      if (fresh.length) {
        setAlerts((prev) => [...prev, ...fresh]);
        beep();
        speak(fresh[0].speak);
      }
    };
    check();
    const t = setInterval(check, 3000);
    window.addEventListener("storage", check);
    window.addEventListener("canteen-orders-changed", check);
    let bc: BroadcastChannel | null = null;
    try { bc = new BroadcastChannel("canteen-pos-orders"); bc.onmessage = () => check(); } catch { /* ignore */ }
    return () => {
      clearInterval(t);
      window.removeEventListener("storage", check);
      window.removeEventListener("canteen-orders-changed", check);
      try { bc?.close(); } catch { /* ignore */ }
    };
  }, [role]);

  // Voice + beep repeat every ~15s until every alert is acknowledged.
  useEffect(() => {
    if (!alerts.length) return;
    const t = setInterval(() => { beep(); speak(alerts[0].speak); }, 15000);
    return () => clearInterval(t);
  }, [alerts]);

  function ack(key: string) {
    if (!seenRef.current) seenRef.current = new Set();
    seenRef.current.add(key);
    try { sessionStorage.setItem(`pos-alert-seen-v1-${role}`, JSON.stringify([...seenRef.current])); } catch { /* ignore */ }
    setAlerts((prev) => prev.filter((a) => a.key !== key));
  }

  if (!alerts.length) return null;
  return (
    <div className="fixed top-2 inset-x-0 z-[80] flex flex-col items-center gap-2 px-3 pointer-events-none" data-testid="order-alerts">
      {alerts.map((a) => (
        <div key={a.key} className="pointer-events-auto w-full max-w-2xl rounded-2xl shadow-2xl border-[3px] px-4 py-3 flex items-center gap-3 pop-in"
          style={{ background: a.kind === "proof" ? "#FFFBEB" : "#F0FDF4", borderColor: a.kind === "proof" ? "#F59E0B" : "#16A34A" }}>
          <span className="text-3xl shrink-0">{a.kind === "proof" ? "💳" : "🔔"}</span>
          <div className="flex-1 min-w-0">
            <div className="font-black leading-tight">{a.headline}</div>
            <div className="text-sm font-bold text-stone-600 truncate">{a.detail}</div>
            <div className="text-[11px] font-bold text-stone-400">🔊 Voice alert har 15 sec repeat hoga jab tak Dekh Liya na dabayein</div>
          </div>
          <button onClick={() => ack(a.key)} data-testid="alert-ack"
            className="rounded-xl px-4 py-2.5 font-black text-white shrink-0 active:scale-[0.98]"
            style={{ background: a.kind === "proof" ? "#F59E0B" : "#16A34A" }}>
            ✓ Dekh Liya
          </button>
        </div>
      ))}
    </div>
  );
}
