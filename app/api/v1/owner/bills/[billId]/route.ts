import { handler, ok } from "@/server/http";
import { q, one, ApiError, rupees } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";
import { fetchOrderDTOById } from "@/server/dto";

export const dynamic = "force-dynamic";

// GET /api/v1/owner/bills/:billId — full receipt DTO for one bill.
export const GET = handler(async (req, ctx: { params: Promise<{ billId: string }> }) => {
  requireOwner(await getStaff(req));
  const { billId } = await ctx.params;
  const b = await one<any>("SELECT b.*, s.kind AS shop_kind FROM bills b JOIN shops s ON s.id = b.shop_id WHERE b.id::text = $1 OR b.bill_no = $1", [billId]);
  if (!b) throw new ApiError(404, "BILL_NOT_FOUND", "Bill nahi mila");
  const links = await q<any>("SELECT order_id FROM bill_orders WHERE bill_id = $1", [b.id]);
  const orders = [];
  for (const l of links) orders.push(await fetchOrderDTOById(l.order_id));
  const payments = await q<any>("SELECT * FROM payments WHERE bill_id = $1 ORDER BY created_at", [b.id]);
  return ok({
    bill: {
      id: b.id, billNo: b.bill_no, shopKind: b.shop_kind, status: b.status,
      subtotal: rupees(b.subtotal_paisa), discount: rupees(b.discount_paisa), total: rupees(b.total_paisa),
      tendered: rupees(b.amount_tendered_paisa), onUdhaar: rupees(b.amount_on_udhaar_paisa), change: rupees(b.change_paisa),
      createdAt: new Date(b.created_at).toISOString(),
      orders,
      payments: payments.map((p) => ({
        id: p.id, kind: p.payment_kind, method: p.method, amount: rupees(p.amount_paisa),
        status: p.status, providerReference: p.provider_reference,
      })),
    },
  });
});
