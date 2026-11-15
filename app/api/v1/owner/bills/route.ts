import { handler, ok } from "@/server/http";
import { q, rupees } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";

export const dynamic = "force-dynamic";

// GET /api/v1/owner/bills?date=&shop=&source= — bill history.
export const GET = handler(async (req) => {
  requireOwner(await getStaff(req));
  const url = new URL(req.url);
  const date = url.searchParams.get("date");
  const shop = url.searchParams.get("shop");
  const rows = await q<any>(
    `SELECT b.*, s.kind AS shop_kind FROM bills b JOIN shops s ON s.id = b.shop_id
     WHERE ($1::date IS NULL OR b.created_at::date = $1::date)
       AND ($2::text IS NULL OR s.kind = $2)
     ORDER BY b.created_at DESC LIMIT 300`,
    [date, shop]
  );
  return ok({
    bills: rows.map((b) => ({
      id: b.id, billNo: b.bill_no, shopKind: b.shop_kind, status: b.status,
      subtotal: rupees(b.subtotal_paisa), discount: rupees(b.discount_paisa), total: rupees(b.total_paisa),
      tendered: rupees(b.amount_tendered_paisa), onUdhaar: rupees(b.amount_on_udhaar_paisa), change: rupees(b.change_paisa),
      createdAt: new Date(b.created_at).toISOString(),
    })),
  });
});
