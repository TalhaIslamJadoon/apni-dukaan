"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import TopBar from "@/components/TopBar";
import StaffGate from "@/components/StaffGate";
import OrderAlerts from "@/components/OrderAlerts";
import Receipt, { paymentPayload } from "@/components/Receipt";
import QRCode from "react-qr-code";
import {
  CATEGORIES, CATEGORY_STYLE, Category, MenuItem, Order, PaymentMethod,
  loadMenu, saveMenu, loadOrders, saveOrders, nextToken, nextBillNo, getStaffSessionMember,
} from "@/lib/store";

interface CartLine { item: MenuItem; qty: number; }

const PAYMENTS: { name: PaymentMethod; emoji: string; color: string }[] = [
  { name: "Cash", emoji: "💵", color: "#16A34A" },
  { name: "JazzCash", emoji: "📱", color: "#ED1C24" },
  { name: "Easypaisa", emoji: "📲", color: "#4CB050" },
  { name: "Udhaar", emoji: "📒", color: "#F59E0B" },
];

function PosPage() {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [cat, setCat] = useState<Category | "All">("All");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("Cash");
  const [discountType, setDiscountType] = useState<"Rs" | "%">("Rs");
  const [discountInput, setDiscountInput] = useState("");
  const [pendingBillNo, setPendingBillNo] = useState("");
  const [tendered, setTendered] = useState(0);
  // Manual cash entry (Talha, 14 Nov): the cashier can also TYPE the amount.
  // tenderedText mirrors `tendered` — typing sets Received directly, the
  // quick-add / Exact / Clear buttons write through applyTendered so both
  // stay in sync. Plain controlled input, same pattern as Discount above.
  const [tenderedText, setTenderedText] = useState("");
  const applyTendered = (n: number) => { setTendered(n); setTenderedText(n > 0 ? String(Math.round(n)) : ""); };
  const typeTendered = (v: string) => { const d = v.replace(/\D/g, ""); setTenderedText(d); setTendered(d === "" ? 0 : parseInt(d, 10)); };
  const [udhaarName, setUdhaarName] = useState("");
  const [done, setDone] = useState<Order | null>(null);
  const [todayTotal, setTodayTotal] = useState(0);
  const [todayCount, setTodayCount] = useState(0);
  // Online canteen orders whose payment proof is still unverified —
  // awareness strip only (they reach the Kitchen after the owner confirms
  // the payment in the Owner Dashboard; confirming happens there, not here).
  const [proofPending, setProofPending] = useState<Order[]>([]);

  useEffect(() => {
    setMenu(loadMenu());
    refreshToday();
    const refreshProof = () => setProofPending(loadOrders().filter((o) =>
      o.source === "online" && o.mode !== "grocery" && o.paymentStatus === "proof_pending" &&
      o.createdAt.slice(0, 10) === new Date().toISOString().slice(0, 10)));
    refreshProof();
    const t = setInterval(refreshProof, 2000);
    window.addEventListener("storage", refreshProof);
    window.addEventListener("canteen-orders-changed", refreshProof);
    return () => { clearInterval(t); window.removeEventListener("storage", refreshProof); window.removeEventListener("canteen-orders-changed", refreshProof); };
  }, []);

  function refreshToday() {
    const orders = loadOrders().filter((o) => o.createdAt.slice(0, 10) === new Date().toISOString().slice(0, 10));
    setTodayTotal(orders.reduce((s, o) => s + o.total, 0));
    setTodayCount(orders.length);
  }

  const total = useMemo(() => cart.reduce((s, l) => s + l.item.price * l.qty, 0), [cart]);
  const discountVal = parseFloat(discountInput) || 0;
  const discountAmt = Math.min(total, discountType === "Rs" ? discountVal : Math.round((total * discountVal) / 100));
  const grand = total - discountAmt;
  const visible = cat === "All" ? menu : menu.filter((m) => m.category === cat);

  // Stepper guard: the tile's press animation shifts the tile mid-press, so a
  // real press on a tile's −/+ can land its click on the TILE (which adds).
  // Steppers therefore act on pointerdown (hit-tested correctly) and stamp
  // this guard; the tile click ignores any click right after a stepper press.
  const stepperGuard = useRef<{ id: string; at: number }>({ id: "", at: 0 });
  const stepperPressed = (id: string) => { stepperGuard.current = { id, at: Date.now() }; };
  const stepperJustPressed = (id: string) => stepperGuard.current.id === id && Date.now() - stepperGuard.current.at < 700;

  function add(item: MenuItem) {
    setCart((c) => {
      const f = c.find((l) => l.item.id === item.id);
      return f ? c.map((l) => (l.item.id === item.id ? { ...l, qty: l.qty + 1 } : l)) : [...c, { item, qty: 1 }];
    });
  }
  function dec(id: string) {
    setCart((c) => c.map((l) => (l.item.id === id ? { ...l, qty: l.qty - 1 } : l)).filter((l) => l.qty > 0));
  }
  function inc(id: string) {
    setCart((c) => c.map((l) => (l.item.id === id ? { ...l, qty: l.qty + 1 } : l)));
  }
  function removeLine(id: string) { setCart((c) => c.filter((l) => l.item.id !== id)); }

  const change = tendered - grand;
  const canComplete = cart.length > 0 && (method !== "Cash" || tendered >= grand);

  function complete() {
    if (!canComplete) return;
    const orders = loadOrders();
    const order: Order = {
      id: `ord-${Date.now()}`,
      mode: "canteen",
      token: nextToken(orders),
      billNo: pendingBillNo || nextBillNo(orders),
      cashier: getStaffSessionMember()?.name ?? "Counter 1",
      lines: cart.map((l) => ({ itemId: l.item.id, name: l.item.name, price: l.item.price, qty: l.qty })),
      subtotal: total,
      discount: discountAmt,
      total: grand,
      payment: method,
      tendered: method === "Cash" ? tendered : undefined,
      change: method === "Cash" ? change : undefined,
      udhaarName: method === "Udhaar" ? (udhaarName.trim() || "—") : undefined,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    saveOrders([order, ...orders]);
    // Deduct canteen stock — same single stock state the Stock screen reads.
    const nextMenu = loadMenu().map((m) => {
      const line = cart.find((l) => l.item.id === m.id);
      return line ? { ...m, stock: Math.max(0, (m.stock ?? 0) - line.qty) } : m;
    });
    saveMenu(nextMenu);
    setMenu(nextMenu);
    setDone(order);
    setCart([]);
    setPayOpen(false);
    applyTendered(0);
    setUdhaarName("");
    setDiscountInput("");
    refreshToday();
  }

  return (
    <div className="min-h-screen lg:h-screen flex flex-col lg:overflow-hidden">
      <TopBar />
      <OrderAlerts role="canteen" />
      <div className="px-4 py-1.5 text-xs font-bold text-stone-500 bg-orange-100/60 flex justify-between">
        <span>🍽️ CANTEEN MODE</span>
        <span>Today: {todayCount} orders · <span style={{ color: "#F97316" }}>Rs {todayTotal.toLocaleString()}</span></span>
      </div>

      {/* ⏳ Payment tasdeeq baqi — online orders waiting for the owner to
          verify their payment proof (read-only awareness; they go to the
          Kitchen only after confirmation in the Owner Dashboard). */}
      {proofPending.length > 0 && (
        <div className="px-4 py-2 border-b border-amber-200 flex flex-wrap items-center gap-x-3 gap-y-1" style={{ background: "#FFFBEB" }} data-testid="pending-proof-strip">
          <span className="font-black text-sm" style={{ color: "#92400E" }}>⏳ Payment tasdeeq baqi ({proofPending.length})</span>
          {proofPending.map((o) => (
            <span key={o.id} className="text-xs font-bold rounded-full bg-white border border-amber-200 px-2.5 py-1">
              {o.customerName} · {o.orderType === "dine-in" ? `Table ${o.tableNo}` : o.placeLabel ?? "Online"} · Rs {o.total.toLocaleString()}
            </span>
          ))}
          <span className="text-[11px] font-bold text-stone-500">— Owner Dashboard se confirm honge, phir Kitchen jayenge</span>
        </div>
      )}

      <div className="flex flex-1 min-h-0 flex-col lg:flex-row overflow-hidden">
        {/* LEFT ~70% — menu */}
        <main className="flex-1 p-3 lg:p-4 overflow-y-auto">
          <div className="flex flex-wrap gap-2 mb-3">
            {(["All", ...CATEGORIES] as const).map((c) => {
              const active = cat === c;
              const color = c === "All" ? "#F97316" : CATEGORY_STYLE[c].chip;
              return (
                <button key={c} onClick={() => setCat(c)}
                  className="rounded-full px-5 py-2.5 text-base font-bold border-2 transition"
                  style={active ? { background: color, borderColor: color, color: "#fff" } : { background: "#fff", borderColor: "#E7E5E4", color: "#44403C" }}>
                  {c}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
            {visible.map((item) => {
              const st = CATEGORY_STYLE[item.category];
              const inCart = cart.find((l) => l.item.id === item.id)?.qty;
              return (
                <div key={item.id} onClick={() => { if (!stepperJustPressed(item.id)) add(item); }} data-testid="canteen-tile" data-name={item.name} role="button" aria-label={`Add ${item.name}`}
                  className="tile-3d relative rounded-2xl p-4 text-left shadow-sm border-2 min-h-[118px] cursor-pointer select-none"
                  style={{ background: st.bg, borderColor: inCart ? st.ring : "transparent" }}>
                  <div className="mb-1">{item.image
                    ? <img src={item.image} alt={item.name} loading="lazy" className="w-12 h-12 rounded-2xl object-cover shadow-sm" />
                    : <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-white/70 shadow-sm text-3xl">{item.emoji}</span>}</div>
                  <div className="font-bold leading-tight text-[15px]">{item.name}</div>
                  <div className="mt-1 font-extrabold" style={{ color: st.chip }}>Rs {item.price}</div>
                  <span className="absolute top-2 right-2 text-[10px] font-bold text-white rounded-full px-2 py-0.5" style={{ background: st.chip }}>{item.category}</span>
                  {/* On-tile stepper (Talha): select/unselect + qty right on the
                      tile. Tile click adds 1; stepper − at qty 1 removes the
                      line (unselect). Stepper clicks stopPropagation so they
                      never double-trigger the tile's own add. */}
                  {inCart ? (
                    <>
                      <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-white/90 shadow px-1 py-1" data-testid="tile-stepper" onClick={(e) => e.stopPropagation()}>
                        <button type="button" aria-label={`Remove one ${item.name}`}
                          onPointerDown={(e) => { e.stopPropagation(); stepperPressed(item.id); dec(item.id); }}
                          onClick={(e) => { e.stopPropagation(); if (e.detail === 0) dec(item.id); }}
                          className="w-8 h-8 rounded-full bg-white border-2 border-stone-300 text-base font-black leading-none active:scale-95">−</button>
                        <span className="min-w-6 text-center font-black text-[15px]" data-testid="tile-qty">{inCart}</span>
                        <button type="button" aria-label={`Add one ${item.name}`}
                          onPointerDown={(e) => { e.stopPropagation(); stepperPressed(item.id); inc(item.id); }}
                          onClick={(e) => { e.stopPropagation(); if (e.detail === 0) inc(item.id); }}
                          className="w-8 h-8 rounded-full text-white text-base font-black leading-none active:scale-95" style={{ background: "#F97316" }}>+</button>
                      </span>
                      <span className="absolute bottom-2 right-2 text-white text-sm font-extrabold rounded-full w-7 h-7 flex items-center justify-center" style={{ background: "#F97316" }}>{inCart}</span>
                    </>
                  ) : (
                    <span className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-white/80 border-2 border-stone-200 shadow-sm flex items-center justify-center text-lg font-black text-stone-500">+</span>
                  )}
                </div>
              );
            })}
          </div>
          {visible.length === 0 && <p className="text-stone-500 p-4">No items in this category yet. Add them from the Owner dashboard.</p>}
        </main>

        {/* RIGHT ~30% — always-visible bill */}
        <aside className="lg:w-[340px] xl:w-[380px] shrink-0 bg-white border-t lg:border-t-0 lg:border-l border-orange-100 flex flex-col max-h-[52vh] lg:max-h-none">
          <div className="px-4 pt-3 pb-2 flex items-center justify-between">
            <h2 className="font-extrabold text-lg">Current Bill</h2>
            {cart.length > 0 && (
              <button onClick={() => setCart([])} className="text-sm font-bold" style={{ color: "#DC2626" }}>Clear ✕</button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-4 space-y-2 pb-2">
            {cart.length === 0 && <p className="text-stone-400 text-center py-8">Tap an item to start the bill 👈</p>}
            {cart.map((l) => (
              <div key={l.item.id} className="flex items-center gap-2 rounded-xl bg-orange-50/60 border border-orange-100 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm truncate">{l.item.name}</div>
                  <div className="text-xs text-stone-500">Rs {l.item.price} × {l.qty} = <b>Rs {l.item.price * l.qty}</b></div>
                </div>
                <button onClick={() => dec(l.item.id)} className="w-9 h-9 rounded-full bg-white border-2 border-stone-200 text-lg font-extrabold">−</button>
                <span className="w-6 text-center font-extrabold">{l.qty}</span>
                <button onClick={() => inc(l.item.id)} className="w-9 h-9 rounded-full bg-white border-2 border-stone-200 text-lg font-extrabold">+</button>
                <button onClick={() => removeLine(l.item.id)} className="w-8 h-8 rounded-full text-white font-bold" style={{ background: "#DC2626" }}>✕</button>
              </div>
            ))}
          </div>
          <div className="p-4 border-t-2 border-stone-800/70 bg-[#FFFBF5]">
            <div className="flex justify-between text-sm py-0.5 border-b border-dashed border-stone-300">
              <span className="font-bold text-stone-500">Subtotal</span><span className="font-bold">Rs {total.toLocaleString()}</span>
            </div>
            {discountAmt > 0 && (
              <div className="flex justify-between text-sm py-0.5 border-b border-dashed border-stone-300">
                <span className="font-bold" style={{ color: "#16A34A" }}>Discount</span><span className="font-bold" style={{ color: "#16A34A" }}>− Rs {discountAmt.toLocaleString()}</span>
              </div>
            )}
            <div className="flex items-end justify-between my-2 py-1.5" style={{ borderTop: "4px double #0F172A", borderBottom: "4px double #0F172A" }}>
              <span className="font-black text-stone-600">GRAND TOTAL</span>
              <span className="text-4xl font-black" style={{ color: "#F97316" }}>Rs {grand.toLocaleString()}</span>
            </div>
            <button disabled={cart.length === 0} onClick={() => { setMethod("Cash"); applyTendered(0); setPendingBillNo(nextBillNo(loadOrders())); setPayOpen(true); }}
              className="w-full rounded-2xl py-4 text-xl font-black text-white disabled:opacity-40 active:scale-[0.99]"
              style={{ background: "#F97316" }}>
              PAY / Charge →
            </button>
          </div>
        </aside>
      </div>

      {/* Payment modal */}
      {payOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-3">
          <div className="bg-white rounded-3xl w-full max-w-lg p-5 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xl font-extrabold">Payment</h3>
              <button onClick={() => setPayOpen(false)} className="text-2xl font-bold text-stone-400">✕</button>
            </div>
            <div className="text-center text-3xl font-black mb-2" style={{ color: "#F97316" }}>Rs {grand.toLocaleString()}</div>
            <div className="text-center text-xs text-stone-400 font-bold mb-3">Bill {pendingBillNo} · Subtotal Rs {total.toLocaleString()}{discountAmt > 0 ? ` · Discount −Rs ${discountAmt.toLocaleString()}` : ""}</div>

            {/* Payment QR — customer scans live at the counter (DEMO merchant) */}
            <div className="rounded-2xl border-2 border-dashed border-stone-300 bg-orange-50/50 p-3 mb-4 text-center pop-in">
              <div className="font-black">📱 Scan to Pay — JazzCash / Easypaisa / Raast</div>
              <div className="flex justify-center my-2 bg-white p-2 rounded-xl w-fit mx-auto shadow-sm">
                <QRCode value={paymentPayload(pendingBillNo || "PENDING", grand)} size={132} />
              </div>
              <span className="text-[10px] font-bold rounded-full px-2 py-0.5" style={{ background: "#FEF3C7", color: "#92400E" }}>Demo QR — merchant account pending</span>
            </div>

            {/* Discount */}
            <div className="flex items-center gap-2 mb-4">
              <span className="font-bold shrink-0">🏷️ Discount:</span>
              <div className="flex rounded-lg overflow-hidden border-2 border-stone-200">
                {(["Rs", "%"] as const).map((t) => (
                  <button key={t} onClick={() => setDiscountType(t)} className="px-3 py-2 font-extrabold text-sm"
                    style={discountType === t ? { background: "#16A34A", color: "#fff" } : { background: "#fff" }}>{t}</button>
                ))}
              </div>
              <input value={discountInput} onChange={(e) => setDiscountInput(e.target.value)} inputMode="decimal" placeholder="0"
                className="w-24 rounded-lg border-2 border-stone-200 px-3 py-2 outline-none focus:border-green-600" />
              {discountAmt > 0 && <span className="font-bold text-sm" style={{ color: "#16A34A" }}>= −Rs {discountAmt.toLocaleString()}</span>}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              {PAYMENTS.map((p) => (
                <button key={p.name} onClick={() => setMethod(p.name)}
                  className="rounded-2xl py-4 text-lg font-extrabold border-[3px] transition"
                  style={method === p.name ? { background: p.color, borderColor: p.color, color: "#fff" } : { background: "#fff", borderColor: "#E7E5E4" }}>
                  {p.emoji} {p.name}
                </button>
              ))}
            </div>

            {method === "Cash" && (
              <div className="mb-4">
                <div className="font-bold mb-2">Cash received:</div>
                <label className="block text-sm font-bold text-stone-500 mb-1">✍️ Ya amount khud likhein:</label>
                <input value={tenderedText} onChange={(e) => typeTendered(e.target.value)} inputMode="numeric" placeholder="Amount likhein (Rs)"
                  className="w-full rounded-xl border-2 border-stone-200 px-4 py-3 text-lg font-black outline-none focus:border-green-600 mb-2" />
                <div className="flex gap-2 mb-2">
                  {[100, 500, 1000].map((a) => (
                    <button key={a} onClick={() => applyTendered(tendered + a)} className="flex-1 rounded-xl py-3 font-extrabold text-white" style={{ background: "#16A34A" }}>+ Rs {a}</button>
                  ))}
                  <button onClick={() => applyTendered(grand)} className="flex-1 rounded-xl py-3 font-extrabold bg-stone-800 text-white">Exact</button>
                  <button onClick={() => applyTendered(0)} className="rounded-xl px-3 py-3 font-bold bg-stone-100">Clear</button>
                </div>
                <div className="flex justify-between text-lg"><span>Received:</span><b>Rs {tendered.toLocaleString()}</b></div>
                <div className="flex justify-between text-xl mt-1">
                  <span className="font-bold">Change (Baqaya):</span>
                  <b style={{ color: change >= 0 ? "#16A34A" : "#DC2626" }}>{change >= 0 ? `Rs ${change.toLocaleString()}` : `Rs ${Math.abs(change)} short`}</b>
                </div>
              </div>
            )}

            {method === "Udhaar" && (
              <div className="mb-4">
                <label className="font-bold block mb-1">Customer / Student / Staff name (khata):</label>
                <input value={udhaarName} onChange={(e) => setUdhaarName(e.target.value)} placeholder="e.g. Ahmed — Staff"
                  className="w-full rounded-xl border-2 border-stone-200 px-4 py-3 text-lg outline-none focus:border-amber-500" />
              </div>
            )}
            {(method === "JazzCash" || method === "Easypaisa") && (
              <p className="mb-4 text-stone-500 text-center">Confirm the {method} payment has been received, then complete.</p>
            )}

            <button disabled={!canComplete} onClick={complete}
              className="w-full rounded-2xl py-4 text-xl font-black text-white disabled:opacity-40" style={{ background: "#16A34A" }}>
              ✓ Complete — Get Token
            </button>
          </div>
        </div>
      )}

      {/* Success / Token + professional bill */}
      {done && (
        <div className="fixed inset-0 z-50 overflow-y-auto p-4" style={{ background: "#0F172A" }}>
          <div className="max-w-md mx-auto py-4">
            <div className="text-center text-white mb-3 flip-in">
              <span className="text-stone-300 font-bold tracking-widest text-sm">TOKEN NUMBER</span>
              <span className="block text-7xl leading-none font-black" style={{ color: "#F97316" }}>{done.token}</span>
              <span className="text-sm" style={{ color: "#16A34A" }}>✅ Payment Done · Order sent to Kitchen 👨‍🍳</span>
            </div>
            <Receipt order={done} />
            <div className="flex gap-2 mt-4 no-print">
              <button onClick={() => window.print()} className="flex-1 rounded-2xl py-4 text-lg font-black bg-white text-stone-900">🖨️ Print Bill (80mm)</button>
              <button onClick={() => setDone(null)} className="flex-1 rounded-2xl py-4 text-lg font-black text-white" style={{ background: "#F97316" }}>+ New Order</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Staff side — role-gated: only staff whose tabs include Canteen see this.
export default function CanteenPosPage() {
  return (
    <StaffGate tab="canteen">
      <PosPage />
    </StaffGate>
  );
}
