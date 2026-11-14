import { handler, ok } from "@/server/http";
import { q, one, ApiError } from "@/server/db";
import { getStaff } from "@/server/auth";

export const dynamic = "force-dynamic";

// GET /api/v1/bills/:billId/payment-options — enabled merchant accounts for
// this bill: the provider's OFFICIAL static QR/payload where configured
// (plan §1.4 Level A). No invented payload is ever generated here.
export const GET = handler(async (req, ctx: { params: Promise<{ billId: string }> }) => {
  const staff = await getStaff(req);
  if (!staff) throw new ApiError(401, "NOT_LOGGED_IN", "Staff login zaroori hai");
  const { billId } = await ctx.params;
  const b = await one<any>("SELECT id, bill_no, total_paisa FROM bills WHERE id::text = $1 OR bill_no = $1", [billId]);
  if (!b) throw new ApiError(404, "BILL_NOT_FOUND", "Bill nahi mila");
  const merchants = await q<any>(
    "SELECT provider, display_name, merchant_ref_masked, qr_payload, qr_image_path, qr_mode FROM merchant_accounts WHERE is_active = true AND (shop_id = $1 OR shop_id IS NULL)",
    [b.shop_id ?? null]
  );
  return ok({
    bill: { id: b.id, billNo: b.bill_no, total: b.total_paisa / 100 },
    options: merchants.map((m) => ({
      provider: m.provider, displayName: m.display_name, refMasked: m.merchant_ref_masked,
      qrPayload: m.qr_payload, qrImagePath: m.qr_image_path, qrMode: m.qr_mode,
    })),
  });
});
