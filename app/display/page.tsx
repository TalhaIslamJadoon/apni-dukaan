"use client";

// ─────────────────────────────────────────────────────────────────────────────
// 🖥️ CANTEEN ORDER BOARD (/display) — customer-facing TV for the canteen.
// KFC-style live status board: token numbers move Ordered → Preparing →
// Taiyar as the kitchen works. VIEW-ONLY: no PIN, no staff controls — it
// only READS the shared order store, using exactly the Kitchen page's sync
// pattern (1s poll + `storage` + `canteen-orders-changed` + BroadcastChannel),
// so a status change in any other tab shows here without a refresh.
//
// STATUS MAPPING (the app's real Order.status values):
//   "pending"   → 🧾 Ordered
//   "preparing" → 👨‍🍳 Preparing (kitchen started)
//   "ready"     → ✅ Taiyar — Delivered (ready for pickup)
// Included: CANTEEN orders ONLY (counter + online) — Talha's rule (15 Nov
// 2026): dono store ki screens alag alag hon. Grocery online orders live
// on their own board at /display-grocery; grocery counter bills are
// created already-"ready" and never enter a queue anyway.
// Payment-proof gate matches the Kitchen: proof_pending / rejected online
// orders (token 0, not yet released) never appear.
//
// TAIYAR COLUMN RULE: a token stays on the board for 10 minutes after it
// FIRST appears as ready on this screen, and the column is capped at the
// 12 most recent — whichever trims first — so the board never goes stale.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import { Order, isPaymentCleared, isToday, loadOrders, useShop } from "@/lib/store";
import { CanteenOnly } from "@/components/BusinessGate";

const TAIYAR_KEEP_MS = 10 * 60 * 1000;
const TAIYAR_CAP = 12;

function tagOf(o: Order): string {
  if (o.orderType === "dine-in" && o.tableNo) return `🍽️ Table ${o.tableNo}`;
  if (o.source === "online" && o.placeLabel) return `🌐 ${o.placeLabel}`;
  if (o.source === "online" && o.orderType === "takeaway") return "🥡 Takeaway";
  if (o.source === "online") return "🌐 Online";
  return "🏪 Counter";
}

function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function DisplayBoard() {
  const shop = useShop();
  const now = useClock();
  const [orders, setOrders] = useState<Order[]>([]);
  // When each order was first SEEN as ready on this screen (10-minute rule)
  const readySinceRef = useRef<Map<string, number>>(new Map());
  const prevReadyRef = useRef<Set<string>>(new Set());
  const bootedRef = useRef(false);
  // Tokens currently inside their "just became ready" flash window
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const [showExit, setShowExit] = useState(true);

  useEffect(() => {
    function refresh() {
      const all = loadOrders();
      const t = Date.now();
      const readyNow = new Set<string>();
      for (const o of all) {
        if (o.status === "ready") {
          readyNow.add(o.id);
          if (!readySinceRef.current.has(o.id)) readySinceRef.current.set(o.id, t);
        }
      }
      // Flash only genuine live transitions — the first load seeds silently.
      if (bootedRef.current) {
        const fresh = [...readyNow].filter((id) => !prevReadyRef.current.has(id));
        if (fresh.length) {
          setFlashIds((prev) => new Set([...prev, ...fresh]));
          fresh.forEach((id) => setTimeout(() => {
            setFlashIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
          }, 6000));
        }
      }
      bootedRef.current = true;
      prevReadyRef.current = readyNow;
      // Prune bookkeeping for orders that no longer exist
      for (const id of [...readySinceRef.current.keys()]) {
        if (!all.some((o) => o.id === id)) readySinceRef.current.delete(id);
      }
      setOrders(all);
    }
    refresh();
    const t = setInterval(refresh, 1000);
    let bc: BroadcastChannel | null = null;
    try { bc = new BroadcastChannel("canteen-pos-orders"); bc.onmessage = refresh; } catch { /* older browser */ }
    window.addEventListener("storage", refresh);
    window.addEventListener("canteen-orders-changed", refresh);
    return () => {
      clearInterval(t);
      try { bc?.close(); } catch { /* ignore */ }
      window.removeEventListener("storage", refresh);
      window.removeEventListener("canteen-orders-changed", refresh);
    };
  }, []);

  // Exit control auto-fades after 4s; any mouse move / touch brings it back.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const wake = () => { setShowExit(true); clearTimeout(t); t = setTimeout(() => setShowExit(false), 4000); };
    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("touchstart", wake);
    return () => { clearTimeout(t); window.removeEventListener("mousemove", wake); window.removeEventListener("touchstart", wake); };
  }, []);

  const onBoard = orders.filter(
    (o) => isToday(o) && isPaymentCleared(o) && o.token > 0 && o.mode !== "grocery"
  );
  const ordered = onBoard.filter((o) => o.status === "pending").sort((a, b) => a.token - b.token);
  const preparing = onBoard.filter((o) => o.status === "preparing").sort((a, b) => a.token - b.token);
  const taiyar = onBoard
    .filter((o) => o.status === "ready")
    .filter((o) => Date.now() - (readySinceRef.current.get(o.id) ?? Date.now()) <= TAIYAR_KEEP_MS)
    .sort((a, b) => (readySinceRef.current.get(b.id) ?? 0) - (readySinceRef.current.get(a.id) ?? 0))
    .slice(0, TAIYAR_CAP);

  const columns: { key: string; title: string; color: string; soft: string; list: Order[]; empty: string }[] = [
    { key: "ordered", title: "🧾 Ordered", color: "#F59E0B", soft: "rgba(245,158,11,0.14)", list: ordered, empty: "Koi naya order nahi" },
    { key: "preparing", title: "👨‍🍳 Preparing", color: "#F97316", soft: "rgba(249,115,22,0.14)", list: preparing, empty: "Abhi kuch nahi ban raha" },
    { key: "taiyar", title: "✅ Taiyar — Le Jayein", color: "#16A34A", soft: "rgba(22,163,74,0.16)", list: taiyar, empty: "Koi token taiyar nahi" },
  ];

  return (
    <div className="min-h-screen flex flex-col text-white select-none" style={{ background: "#0F172A" }}>
      {/* Header — shop name + live clock */}
      <header className="flex items-center gap-4 px-6 sm:px-10 pt-6 pb-4">
        <div className="text-5xl sm:text-6xl">🏪</div>
        <div className="flex-1 min-w-0">
          <div className="font-black leading-tight line-clamp-2" style={{ fontSize: "clamp(1.9rem, 4.5vw, 3.8rem)" }}>
            {shop.canteenName}
          </div>
          <div className="opacity-60 font-bold line-clamp-2 mt-1" style={{ fontSize: "clamp(0.85rem, 1.4vw, 1.25rem)" }}>
            {shop.collegeName ? `${shop.collegeName} · ` : ""}Apna token number dekhein — taiyar honay par yahan ayega
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-black tabular-nums leading-none" style={{ fontSize: "clamp(1.7rem, 3.6vw, 3.2rem)", color: "#F97316" }}>
            {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
          <div className="opacity-60 font-bold mt-1" style={{ fontSize: "clamp(0.8rem, 1.3vw, 1.15rem)" }}>
            {now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
          </div>
        </div>
      </header>

      {/* Three status columns */}
      <main className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5 px-4 sm:px-8 pb-8 min-h-0">
        {columns.map((col) => (
          <section key={col.key} data-column={col.key}
            className="rounded-3xl flex flex-col min-h-0 overflow-hidden"
            style={{ background: col.soft, border: `2px solid ${col.color}` }}>
            <h2 className="text-center font-black py-3 sm:py-4 shrink-0"
              style={{ fontSize: "clamp(1.4rem, 2.6vw, 2.4rem)", background: col.color, color: "#fff" }}>
              {col.title}
              <span className="ml-3 inline-block rounded-full bg-black/25 px-3 py-0.5 align-middle" style={{ fontSize: "0.55em" }}>
                {col.list.length}
              </span>
            </h2>
            <div className="flex-1 overflow-hidden p-3 sm:p-4">
              {col.list.length === 0 ? (
                <div className="h-full min-h-24 flex items-center justify-center text-center font-bold opacity-40"
                  style={{ fontSize: "clamp(1rem, 1.6vw, 1.4rem)" }}>
                  {col.empty}
                </div>
              ) : (
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 content-start">
                  {col.list.map((o) => (
                    <div key={o.id} data-token={o.token}
                      className={`rounded-2xl bg-white text-center px-1 py-3 sm:py-4 ${flashIds.has(o.id) ? "taiyar-flash" : ""}`}
                      style={{ border: "3px solid transparent", boxShadow: "0 6px 18px rgba(0,0,0,0.35)" }}>
                      <div className="font-black leading-none" style={{ color: "#0F172A", fontSize: "clamp(2.4rem, 4.6vw, 4.6rem)" }}>
                        {o.token}
                      </div>
                      <div className="font-extrabold mt-1 leading-tight line-clamp-2 px-1" style={{ color: col.color, fontSize: "clamp(0.7rem, 1.15vw, 1.05rem)" }}>
                        {tagOf(o)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        ))}
      </main>

      <footer className="text-center pb-4 opacity-50 font-bold shrink-0" style={{ fontSize: "clamp(0.8rem, 1.2vw, 1.1rem)" }}>
        🍽️ {shop.canteenName} · Token taiyar honay par counter se le jayein — Shukriya!
      </footer>

      {/* Exit — tiny corner control, auto-fades (a running TV rarely needs it) */}
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
export default function DisplayPage() {
  return (
    <CanteenOnly what="Canteen Order Screen">
      <DisplayBoard />
    </CanteenOnly>
  );
}
