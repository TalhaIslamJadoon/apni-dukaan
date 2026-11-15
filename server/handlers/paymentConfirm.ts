// Manual payment confirmation (Level A, plan §1.4): a static merchant QR
// gives NO automatic proof — a staff member verifies receipt in the
// provider app/portal, then confirms here. If the payment belongs to a
// proof-flow order still pending verification, confirming also releases
// that order (token assigned, fulfilment unlocked).
import { handler, ok } from "@/server/http";
import { tx, one, ApiError } from "@/server/db";
import { getStaff, requireStaff } from "@/server/auth";
import { confirmPayment } from "@/server/services/orders";
import { emit, audit } from "@/server/events";

export const confirmPaymentHandler = handler(async (req, ctx: { params: Promise<{ paymentId: string }> }) => {
  const staff = requireStaff(await getStaff(req));
  const { paymentId } = await ctx.params;
  const p = await one<any>("SELECT * FROM payments WHERE id::text = $1", [paymentId]);
  if (!p) throw new ApiError(404, "PAYMENT_NOT_FOUND", "Payment nahi mili");
  if (p.status === "confirmed") return ok({ payment: { id: p.id, status: "confirmed" } });
  if (p.status !== "pending_confirmation" && p.status !== "initiated") {
    throw new ApiError(409, "BAD_PAYMENT_STATE", `Payment ${p.status} hai — confirm nahi ho sakti`);
  }
  // Proof-flow order attached? Release it through the order service.
  if (p.bill_id) {
    const link = await one<any>("SELECT order_id FROM bill_orders WHERE bill_id = $1", [p.bill_id]);
    if (link) {
      const ord = await one<any>("SELECT payment_status FROM orders WHERE id = $1", [link.order_id]);
      if (ord?.payment_status === "proof_pending") {
        const order = await confirmPayment(link.order_id, staff);
        return ok({ order, payment: { id: p.id, status: "confirmed" } });
      }
    }
  }
  await tx(async (c) => {
    await c.query(
      "UPDATE payments SET status = 'confirmed', confirmed_by_staff_id = $2, confirmed_at = now() WHERE id = $1",
      [p.id, staff.id]
    );
    await emit(c, "dashboard.changed", "dashboard", null, {});
    await audit(c, { type: "staff", staffId: staff.id }, "payment.confirm", "payment", p.id, {});
  });
  return ok({ payment: { id: p.id, status: "confirmed" } });
});
