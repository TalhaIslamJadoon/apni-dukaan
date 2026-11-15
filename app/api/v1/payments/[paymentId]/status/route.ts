import { handler, ok } from "@/server/http";
import { one, ApiError, rupees } from "@/server/db";
import { getStaff, getCustomer } from "@/server/auth";

export const dynamic = "force-dynamic";

// GET /api/v1/payments/:paymentId/status — staff, or the customer whose
// order the payment belongs to.
export const GET = handler(async (req, ctx: { params: Promise<{ paymentId: string }> }) => {
  const { paymentId } = await ctx.params;
  const staff = await getStaff(req);
  const customer = await getCustomer(req);
  if (!staff && !customer) throw new ApiError(401, "NOT_LOGGED_IN", "Login zaroori hai");
  const p = await one<any>("SELECT * FROM payments WHERE id::text = $1", [paymentId]);
  if (!p) throw new ApiError(404, "PAYMENT_NOT_FOUND", "Payment nahi mili");
  if (!staff && customer) {
    const link = p.bill_id ? await one<any>(
      "SELECT o.customer_id FROM bill_orders bo JOIN orders o ON o.id = bo.order_id WHERE bo.bill_id = $1", [p.bill_id]
    ) : null;
    if (!link || link.customer_id !== customer.id) throw new ApiError(403, "FORBIDDEN", "Ye aap ki payment nahi hai");
  }
  return ok({
    payment: {
      id: p.id, method: p.method, kind: p.payment_kind, amount: rupees(p.amount_paisa),
      status: p.status, providerReference: p.provider_reference,
      confirmedAt: p.confirmed_at ? new Date(p.confirmed_at).toISOString() : null,
    },
  });
});
