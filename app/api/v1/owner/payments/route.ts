import { handler, ok } from "@/server/http";
import { q, rupees } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";

export const dynamic = "force-dynamic";

// GET /api/v1/owner/payments?status=pending_confirmation — payment records
// for the owner (e.g. Level-A static-QR payments awaiting confirmation).
export const GET = handler(async (req) => {
  requireOwner(await getStaff(req));
  const status = new URL(req.url).searchParams.get("status");
  const rows = await q<any>(
    `SELECT p.*, b.bill_no FROM payments p LEFT JOIN bills b ON b.id = p.bill_id
     WHERE ($1::text IS NULL OR p.status = $1) ORDER BY p.created_at DESC LIMIT 300`,
    [status]
  );
  return ok({
    payments: rows.map((p) => ({
      id: p.id, billId: p.bill_id, billNo: p.bill_no, kind: p.payment_kind, method: p.method,
      amount: rupees(p.amount_paisa), status: p.status, providerReference: p.provider_reference,
      createdAt: new Date(p.created_at).toISOString(),
      confirmedAt: p.confirmed_at ? new Date(p.confirmed_at).toISOString() : null,
    })),
  });
});
