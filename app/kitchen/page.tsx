"use client";

import { useEffect, useState } from "react";
import TopBar from "@/components/TopBar";
import StaffGate from "@/components/StaffGate";
import { CanteenOnly } from "@/components/BusinessGate";
import OrderAlerts from "@/components/OrderAlerts";
import { Order, loadOrders, saveOrders, isToday, isPaymentCleared } from "@/lib/store";

function KitchenScreen() {
  const [orders, setOrders] = useState<Order[]>([]);

  function refresh() { setOrders(loadOrders()); }
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1000);
    window.addEventListener("storage", refresh);
    window.addEventListener("canteen-orders-changed", refresh);
    return () => { clearInterval(t); window.removeEventListener("storage", refresh); window.removeEventListener("canteen-orders-changed", refresh); };
  }, []);

  function ready(id: string) {
    const all = loadOrders().map((o) => (o.id === id ? { ...o, status: "ready" as const } : o));
    saveOrders(all); setOrders(all);
  }
  function startPreparing(id: string) {
    const all = loadOrders().map((o) => (o.id === id ? { ...o, status: "preparing" as const } : o));
    saveOrders(all); setOrders(all);
  }

  // Kitchen only serves CANTEEN orders (counter + online) — grocery never comes here.
  // Payment-proof gate: online orders whose payment is still proof_pending /
  // rejected are EXCLUDED — they reach the kitchen only after staff confirm
  // the payment in the Owner Dashboard (which also assigns their token).
  const pending = orders.filter((o) => isToday(o) && o.mode !== "grocery" && isPaymentCleared(o) && o.status !== "ready").sort((a, b) => a.token - b.token);
  const readyList = orders.filter((o) => isToday(o) && o.mode !== "grocery" && isPaymentCleared(o) && o.status === "ready").sort((a, b) => b.token - a.token);

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar />
      <OrderAlerts role="kitchen" />
      <div className="px-4 py-1.5 text-xs font-bold text-stone-500 bg-orange-100/60">
        👨‍🍳 KITCHEN — CANTEEN TOKENS · {pending.length} waiting
      </div>

      <main className="p-4">
        {pending.length === 0 && (
          <div className="text-center py-20">
            <div className="text-6xl mb-3">🎉</div>
            <div className="text-2xl font-extrabold text-stone-600">No pending orders</div>
            <p className="text-stone-400">New tokens will appear here automatically.</p>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {pending.map((o) => (
            <div key={o.id} className="bg-white rounded-3xl border-2 shadow-sm p-5" style={{ borderColor: "#F59E0B" }}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs font-bold tracking-widest" style={{ color: "#F59E0B" }}>TOKEN</div>
                  <div className="text-7xl font-black leading-none" style={{ color: "#0F172A" }}>{o.token}</div>
                </div>
                <div className="text-right text-sm text-stone-500">
                  <div>{new Date(o.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                  <div className="font-bold text-stone-700">{o.payment}</div>
                  <span className="inline-block mt-1 text-[10px] font-black rounded-full px-2 py-0.5" style={{ background: "#FEF3C7", color: "#92400E" }}>⏳ {o.status === "preparing" ? "PREPARING" : "PENDING"}</span>
                </div>
              </div>
              {/* Source + type label — Counter / Online-Hostel / Table Dine-In / Takeaway */}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {o.source !== "online" && (
                  <span className="text-[11px] font-black rounded-full px-2.5 py-1 text-white" style={{ background: "#0F172A" }}>🏪 COUNTER</span>
                )}
                {o.source === "online" && o.orderType === "dine-in" && (
                  <span className="text-sm font-black rounded-full px-3 py-1 text-white" style={{ background: "#16A34A" }}>🍽️ DINE-IN — TABLE {o.tableNo}</span>
                )}
                {o.source === "online" && o.orderType !== "dine-in" && o.customerMobile && (
                  <span className="text-[11px] font-black rounded-full px-2.5 py-1 text-white" style={{ background: "#1976D2" }}>🌐 ONLINE{o.placeLabel ? ` — ${o.placeLabel.toUpperCase()}` : " — HOSTEL/OFFICE PICKUP"}</span>
                )}
                {o.source === "online" && o.orderType !== "dine-in" && !o.customerMobile && (
                  <span className="text-[11px] font-black rounded-full px-2.5 py-1 text-white" style={{ background: "#F97316" }}>🥡 TAKEAWAY — ONLINE</span>
                )}
                {o.source === "online" && (
                  <span className="text-xs font-bold text-stone-500">
                    👤 {o.customerName || "Guest"}{o.customerMobile ? ` — ${o.customerMobile}` : ""}{o.customerId ? ` — ID: ${o.customerId}` : ""}
                  </span>
                )}
              </div>
              <ul className="mt-3 space-y-1 text-lg">
                {o.lines.map((l) => (
                  <li key={l.itemId} className="border-b border-dashed border-stone-200 pb-1">
                    <div className="flex justify-between">
                      <span className={`flex-1 min-w-0 pr-2 leading-snug ${l.components?.length ? "font-extrabold" : ""}`}>{l.name}</span><b className="shrink-0">× {l.qty}</b>
                    </div>
                    {/* 🎁 Deal: the kitchen must make EVERY component —
                        totals = per-deal qty × deal qty, nothing missed. */}
                    {l.components?.map((c) => (
                      <div key={c.itemId} className="flex justify-between pl-5 text-base text-stone-600" data-testid="kitchen-deal-component">
                        <span className="flex-1 min-w-0 pr-2 leading-snug">↳ {c.name}</span><b className="shrink-0">× {c.qty * l.qty}</b>
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
              {o.status === "pending" && (
                <button onClick={() => startPreparing(o.id)} className="mt-4 w-full rounded-2xl py-3 text-lg font-black text-white active:scale-[0.99]" style={{ background: "#F59E0B" }}>
                  🍳 Start Preparing
                </button>
              )}
              <button onClick={() => ready(o.id)} className="mt-3 w-full rounded-2xl py-4 text-xl font-black text-white active:scale-[0.99]" style={{ background: "#16A34A" }}>
                ✓ READY
              </button>
            </div>
          ))}
        </div>

        {readyList.length > 0 && (
          <>
            <h2 className="mt-8 mb-3 font-extrabold text-stone-500">Ready today ({readyList.length})</h2>
            <div className="flex flex-wrap gap-2">
              {readyList.map((o) => (
                <span key={o.id} className="rounded-full px-4 py-2 font-black text-white" style={{ background: "#16A34A" }}>✓ {o.token}</span>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// Staff side — role-gated: only staff whose tabs include Kitchen see this.
// Business gate: kitchen canteen ka hissa hai — canteen off ho to notice.
export default function KitchenPage() {
  return (
    <StaffGate tab="kitchen">
      <CanteenOnly what="Kitchen">
        <KitchenScreen />
      </CanteenOnly>
    </StaffGate>
  );
}
