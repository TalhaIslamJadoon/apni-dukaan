"use client";

import QRCode from "react-qr-code";
import { Order, SHOP, billNoOf, useShop } from "@/lib/store";

// DEMO merchant — Talha's real JazzCash / Easypaisa / Raast merchant ID is
// NOT yet provided. This payload is a placeholder pattern only; no live
// payment can be received through it. Phase 2: replace DEMO_MERCHANT with
// the real merchant payload format.
export const DEMO_MERCHANT = "DEMO-POS-001";

export function paymentPayload(billNo: string, total: number): string {
  return `PAY|MERCHANT:${DEMO_MERCHANT}|BILL:${billNo}|AMOUNT:${Math.round(total)}|PKR`;
}

const money = (n: number) => `Rs ${Math.round(n).toLocaleString()}`;
const qty = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(1));

// Professional bill with PROPER LINE SPLITS between every section:
// header+QR row | meta | items header | item rows (hairline each)
// | totals (double line around Grand Total) | paid/change | footer.
// On print (80mm) the solid rules become dashed thermal dividers.
export default function Receipt({ order }: { order: Order }) {
  const shop = useShop();
  const billNo = billNoOf(order);
  const d = new Date(order.createdAt);
  const subtotal = order.subtotal ?? order.total;
  const discount = order.discount ?? 0;
  const paid = order.tendered ?? order.total;

  return (
    <div id="thermal-bill" className="flip-in bg-white text-stone-900 rounded-2xl shadow-xl w-full max-w-[380px] mx-auto px-5 py-5 text-sm">
      {/* ── Shop header + Payment QR on ONE row ──────────
          Talha (14 Nov): the QR as its own big section under the header
          ate far too much vertical space — it now sits on the first line,
          beside the shop name (compact ~76px; the print stylesheet grows
          it to ~26mm on paper so it stays scannable). */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-3xl mb-1">🏪</div>
          <div className="text-xl font-black tracking-wide leading-tight">{order.mode === "grocery" ? shop.groceryName : shop.canteenName}</div>
          {shop.collegeName ? <div className="text-xs text-stone-500 font-bold">{shop.collegeName}</div> : null}
          <div className="text-[11px] text-stone-400">{SHOP.systemName} · names editable in Owner Dashboard → Shop Settings</div>
        </div>
        <div className="shrink-0 text-center">
          <div className="receipt-qr flex justify-center">
            <QRCode value={paymentPayload(billNo, order.total)} size={76} />
          </div>
          <div className="text-[11px] font-black mt-1 leading-tight">📱 Scan to Pay</div>
          <div className="text-[9px] font-bold text-stone-500 leading-tight">JazzCash · Easypaisa · Raast</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 mt-2">
        <span className="text-[11px] text-stone-400">Bill {billNo} · {money(order.total)}</span>
        <span className="inline-block text-[10px] font-bold rounded-full px-2 py-0.5 no-print" style={{ background: "#FEF3C7", color: "#92400E" }}>
          Demo QR — merchant account pending
        </span>
      </div>

      <div className="receipt-rule my-3" />

      {/* ── Bill meta — COMPACT (Talha, 14 Nov): 2–3 items packed per
          line instead of one full row each; same values, same order.
          text-[13px] so both lines fit the 80mm/phone width without
          wrapping (long cashier names wrap gracefully via flex-wrap). ── */}
      <div className="space-y-1 text-[13px]">
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span><span className="text-stone-500 font-bold">Bill No:</span> <b>{billNo}</b></span>
          <span className="text-stone-300">·</span>
          <span><span className="text-stone-500 font-bold">Date:</span> {`${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`} · {d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span><span className="text-stone-500 font-bold">Cashier:</span> {order.cashier || "Counter 1"}</span>
          <span className="text-stone-300">·</span>
          <span><span className="text-stone-500 font-bold">Mode:</span> {order.mode === "grocery" ? `Grocery (${order.priceType || "retail"})` : "Canteen"}</span>
          {order.mode !== "grocery" && (
            <>
              <span className="text-stone-300">·</span>
              <span><span className="text-stone-500 font-bold">Token:</span> <b style={{ color: "#F97316" }}>{order.token}</b></span>
            </>
          )}
        </div>
        {order.source === "online" && order.mode !== "grocery" && (
          <>
            <div className="flex justify-between"><span className="text-stone-500 font-bold">Type:</span>
              <b>{order.orderType === "dine-in" ? `🍽️ DINE-IN — Table ${order.tableNo}` : order.placeLabel ? `🌐 ONLINE — ${order.placeLabel} (Pickup)` : "🥡 TAKEAWAY — Pickup"}</b></div>
            <div className="flex justify-between"><span className="text-stone-500 font-bold">Customer:</span>
              <b>{order.customerName}{order.customerMobile ? ` — ${order.customerMobile}` : ""}{order.customerId ? ` — ID: ${order.customerId}` : ""}</b></div>
          </>
        )}
        {order.source === "online" && order.mode === "grocery" && (
          <>
            <div className="flex justify-between"><span className="text-stone-500 font-bold">Type:</span>
              <b>🌐 ONLINE ORDER{order.placeLabel ? ` — ${order.placeLabel}` : ""} (Pickup)</b></div>
            <div className="flex justify-between"><span className="text-stone-500 font-bold">Customer:</span>
              <b>{order.customerName}{order.customerMobile ? ` — ${order.customerMobile}` : ""}{order.customerId ? ` — ID: ${order.customerId}` : ""}</b></div>
          </>
        )}
        {order.udhaarName && (
          <div className="flex justify-between"><span className="text-stone-500 font-bold">Customer (Udhaar):</span><b>{order.udhaarName}</b></div>
        )}
      </div>

      <div className="receipt-rule my-3" />

      {/* ── Items ───────────────────────────────────── */}
      <div className="grid grid-cols-[1fr_38px_58px_68px] gap-x-1 font-black text-xs text-stone-500 pb-1">
        <span>ITEM</span><span className="text-right">QTY</span><span className="text-right">RATE</span><span className="text-right">AMOUNT</span>
      </div>
      <div className="receipt-rule-strong" />
      {order.lines.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_38px_58px_68px] gap-x-1 py-1.5 border-b border-stone-100">
          <span className="font-semibold leading-tight">{l.name}</span>
          <span className="text-right">{qty(l.qty)}</span>
          <span className="text-right">{Math.round(l.price).toLocaleString()}</span>
          <span className="text-right font-bold">{Math.round(l.price * l.qty).toLocaleString()}</span>
        </div>
      ))}

      {/* ── Totals ──────────────────────────────────── */}
      <div className="receipt-rule mt-1" />
      <div className="flex justify-between py-1"><span className="font-bold text-stone-500">Subtotal</span><span className="font-bold">{money(subtotal)}</span></div>
      {discount > 0 && (
        <div className="flex justify-between py-0.5 border-b border-stone-100">
          <span className="font-bold" style={{ color: "#16A34A" }}>Discount</span>
          <span className="font-bold" style={{ color: "#16A34A" }}>− {money(discount)}</span>
        </div>
      )}
      <div className="receipt-rule-double my-1.5 py-2 flex justify-between items-center">
        <span className="font-black text-base">GRAND TOTAL</span>
        <span className="font-black text-xl" style={{ color: "#F97316" }}>{money(order.total)}</span>
      </div>

      {/* ── Payment ─────────────────────────────────── */}
      <div className="flex justify-between py-1 border-b border-stone-100">
        <span className="font-bold text-stone-500">Payment Method</span>
        <span className="font-black rounded-full px-2.5 py-0.5 text-xs text-white" style={{ background: order.payment === "Udhaar" ? "#F59E0B" : "#16A34A" }}>{order.payment}</span>
      </div>
      {order.payment === "Cash" && (
        <>
          <div className="flex justify-between py-1 border-b border-stone-100"><span className="font-bold text-stone-500">Amount Paid</span><span className="font-bold">{money(paid)}</span></div>
          <div className="flex justify-between py-1"><span className="font-bold text-stone-500">Change (Baqaya)</span><span className="font-bold" style={{ color: "#16A34A" }}>{money(order.change ?? 0)}</span></div>
        </>
      )}
      {order.payment === "Udhaar" && (
        <div className="flex justify-between py-1"><span className="font-bold text-stone-500">Added to Khata</span><span className="font-bold" style={{ color: "#F59E0B" }}>{money(order.total)}</span></div>
      )}

      <div className="receipt-rule my-3" />

      {/* ── Footer ──────────────────────────────────── */}
      <div className="text-center">
        <div className="font-black">Thank You! 🙏</div>
        <div className="text-xs text-stone-400">Please visit again · Bill {billNo}</div>
      </div>
    </div>
  );
}
