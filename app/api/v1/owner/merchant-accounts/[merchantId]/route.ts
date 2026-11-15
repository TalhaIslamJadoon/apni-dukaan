import { handler, ok, body } from "@/server/http";
import { q, ApiError } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";

export const dynamic = "force-dynamic";

export const PATCH = handler(async (req, ctx: { params: Promise<{ merchantId: string }> }) => {
  requireOwner(await getStaff(req));
  const { merchantId } = await ctx.params;
  const b = await body<any>(req);
  const r = await q(
    `UPDATE merchant_accounts SET display_name = COALESCE($2, display_name),
       merchant_ref_masked = COALESCE($3, merchant_ref_masked), qr_payload = COALESCE($4, qr_payload),
       qr_image_path = COALESCE($5, qr_image_path), qr_mode = COALESCE($6, qr_mode),
       is_active = COALESCE($7, is_active), config_notes = COALESCE($8, config_notes), updated_at = now()
     WHERE id::text = $1 RETURNING id`,
    [merchantId, b.displayName ?? null, b.refMasked ?? null, b.qrPayload ?? null, b.qrImagePath ?? null, b.qrMode ?? null, b.isActive ?? null, b.configNotes ?? null]
  );
  if (!r[0]) throw new ApiError(404, "MERCHANT_NOT_FOUND", "Merchant account nahi mila");
  return ok({ updated: true });
});
