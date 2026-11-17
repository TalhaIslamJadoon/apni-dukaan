"use client";

import { RentalBooking, RentalItem, useShop } from "@/lib/store";

// ─────────────────────────────────────────────────────────────────────────────
// BOOKING SLIP — Kiraya booking ki parchi (80mm receipt style).
// Receipt wale hi print rule par chalti hai: id="thermal-bill" — print
// mein sirf yehi slip nikalti hai. Booking ke waqt bhi print hoti hai aur
// wapsi (settlement) ke baad bhi — settlement wali slip par late fine,
// damage aur security ka poora hisaab chhapta hai.
// ─────────────────────────────────────────────────────────────────────────────

const money = (n: number) => `Rs ${Math.round(n).toLocaleString()}`;
const dstr = (iso?: string) => {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

export default function RentalSlip({ booking, item }: { booking: RentalBooking; item?: RentalItem }) {
  const shop = useShop();
  const balance = Math.max(0, booking.rentTotal - booking.advancePaid - booking.balancePaid);
  const settled = booking.status === "completed";
  return (
    <div id="thermal-bill" className="flip-in bg-white text-stone-900 rounded-2xl shadow-xl w-full max-w-[380px] mx-auto px-5 py-5 text-sm" data-testid="rental-slip">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-3xl mb-1">👰</div>
          <div className="text-xl font-black tracking-wide leading-tight">{shop.groceryName}</div>
          {shop.collegeName ? <div className="text-xs text-stone-500 font-bold">{shop.collegeName}</div> : null}
          <div className="text-[11px] text-stone-400">Kiraya Booking Slip · Booking {booking.bookingNo}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[11px] font-black rounded-full px-2.5 py-1 inline-block text-white" style={{ background: settled ? "#16A34A" : booking.status === "out" ? "#1D4ED8" : "#F59E0B" }}>
            {settled ? "✓ WAPSI HO GAYI" : booking.status === "out" ? "DRESS BAHAR HAI" : "BOOKED"}
          </div>
        </div>
      </div>

      <div className="receipt-rule my-3" />

      <div className="space-y-1 text-[13px]">
        <div className="flex justify-between gap-2"><span className="text-stone-500 font-bold">Dress:</span><b className="text-right">{booking.itemName}{(booking.qty || 1) > 1 ? ` — ${booking.qty} piece` : ""}</b></div>
        {(item?.size || item?.color) && (
          <div className="flex justify-between gap-2"><span className="text-stone-500 font-bold">Size / Rang:</span><b>{[item?.size, item?.color].filter(Boolean).join(" · ")}</b></div>
        )}
        <div className="flex justify-between gap-2"><span className="text-stone-500 font-bold">Customer:</span><b className="text-right">{booking.customerName}</b></div>
        <div className="flex justify-between gap-2"><span className="text-stone-500 font-bold">Mobile:</span><b>{booking.customerMobile}</b></div>
        {booking.customerCnic && (
          <div className="flex justify-between gap-2"><span className="text-stone-500 font-bold">CNIC:</span><b>{booking.customerCnic}</b></div>
        )}
        <div className="flex justify-between gap-2"><span className="text-stone-500 font-bold">Lene ki Tareekh:</span><b>{dstr(booking.pickupDate)}</b></div>
        <div className="flex justify-between gap-2"><span className="text-stone-500 font-bold">Wapsi ki Tareekh:</span><b>{dstr(booking.returnDate)}</b></div>
        <div className="flex justify-between gap-2"><span className="text-stone-500 font-bold">Din:</span><b>{booking.days} din × {money(booking.rentPerDay)}{(booking.qty || 1) > 1 ? ` × ${booking.qty} piece` : ""}</b></div>
        {booking.listRentPerDay && booking.listRentPerDay > booking.rentPerDay && (
          <div className="flex justify-between gap-2"><span className="font-bold" style={{ color: "#DC2626" }}>🎉 Offer Laga:</span><b className="text-right">roz ka kiraya <s className="text-stone-400">{money(booking.listRentPerDay)}</s> ki jagah {money(booking.rentPerDay)}</b></div>
        )}
      </div>

      <div className="receipt-rule my-3" />

      <div className="space-y-1 text-[13px]">
        <div className="flex justify-between py-0.5"><span className="font-bold text-stone-500">Kul Kiraya</span><span className="font-black">{money(booking.rentTotal)}</span></div>
        <div className="flex justify-between py-0.5 border-b border-stone-100"><span className="font-bold text-stone-500">Advance Wasool</span><span className="font-bold" style={{ color: "#16A34A" }}>{money(booking.advancePaid)}</span></div>
        {booking.balancePaid > 0 && (
          <div className="flex justify-between py-0.5 border-b border-stone-100"><span className="font-bold text-stone-500">Pickup Par Wasool</span><span className="font-bold" style={{ color: "#16A34A" }}>{money(booking.balancePaid)}</span></div>
        )}
        {balance > 0 && !settled && (
          <div className="flex justify-between py-0.5"><span className="font-black" style={{ color: "#DC2626" }}>Baqaya (Rent)</span><span className="font-black" style={{ color: "#DC2626" }}>{money(balance)}</span></div>
        )}
        <div className="flex justify-between py-0.5"><span className="font-bold text-stone-500">Security Deposit ({booking.securityKind})</span><span className="font-bold">{money(booking.securityDeposit)}</span></div>
      </div>

      {settled && (
        <>
          <div className="receipt-rule my-3" />
          <div className="space-y-1 text-[13px]">
            <div className="font-black">↩️ Wapsi Hisaab — {dstr(booking.actualReturnDate)}</div>
            {(booking.lateDays ?? 0) > 0 && (
              <div className="flex justify-between py-0.5 border-b border-stone-100"><span className="font-bold text-stone-500">Late Fine ({booking.lateDays} din × {money(booking.lateFinePerDay)})</span><span className="font-bold">{money(booking.lateFine ?? 0)}</span></div>
            )}
            {(booking.damageCharges ?? 0) > 0 && (
              <div className="flex justify-between py-0.5 border-b border-stone-100"><span className="font-bold text-stone-500">Damage Charges{booking.damageNote ? ` — ${booking.damageNote}` : ""}</span><span className="font-bold">{money(booking.damageCharges ?? 0)}</span></div>
            )}
            <div className="flex justify-between py-0.5 border-b border-stone-100"><span className="font-bold text-stone-500">Security Se Katoti</span><span className="font-bold">− {money(booking.securityDeducted ?? 0)}</span></div>
            <div className="flex justify-between py-0.5"><span className="font-black">Security Wapas Mili</span><span className="font-black" style={{ color: "#16A34A" }}>{money(booking.securityRefunded ?? 0)}</span></div>
            {(booking.extraDue ?? 0) > 0 && (
              <div className="flex justify-between py-0.5"><span className="font-black" style={{ color: "#DC2626" }}>Mazeed Wasool (Charges Zyada)</span><span className="font-black" style={{ color: "#DC2626" }}>{money(booking.extraDue ?? 0)}</span></div>
            )}
          </div>
        </>
      )}

      <div className="receipt-rule my-3" />
      <div className="text-center">
        <div className="font-black">Shukriya! 🙏</div>
        <div className="text-xs text-stone-400">Dress waqt par saaf halat mein wapas karein — late par roz ka fine lagega · Booking {booking.bookingNo}</div>
      </div>
    </div>
  );
}
