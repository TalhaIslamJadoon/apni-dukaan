import { handler, ok, body } from "@/server/http";
import { q, ApiError } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";

export const dynamic = "force-dynamic";

// Merchant QR image — Talha's official provider QR (scan-and-pay poster from
// the JazzCash/Easypaisa/Raast/bank app), stored as bytea IN the database so
// the daily pg_dump backup carries it with everything else. Served to
// customers by /api/v1/public/merchant-qr/[provider].

const MIMES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 2 * 1024 * 1024;

// POST { imageBase64, mime } — upload/replace this merchant's QR image.
export const POST = handler(async (req, ctx: { params: Promise<{ merchantId: string }> }) => {
  requireOwner(await getStaff(req));
  const { merchantId } = await ctx.params;
  const b = await body<{ imageBase64?: string; mime?: string }>(req);
  if (!b.imageBase64 || !MIMES.includes(b.mime ?? "")) {
    throw new ApiError(400, "BAD_IMAGE", "QR image PNG, JPG ya WebP format mein bhejein");
  }
  const buf = Buffer.from(b.imageBase64, "base64");
  if (buf.length === 0 || buf.length > MAX_BYTES) {
    throw new ApiError(400, "IMAGE_TOO_LARGE", "QR image 2MB se chhoti rakhein");
  }
  const r = await q(
    "UPDATE merchant_accounts SET qr_image = $2, qr_image_mime = $3, qr_image_path = 'db', updated_at = now() WHERE id::text = $1 RETURNING id",
    [merchantId, buf, b.mime]
  );
  if (!r[0]) throw new ApiError(404, "MERCHANT_NOT_FOUND", "Merchant account nahi mila");
  return ok({ uploaded: true });
});

// DELETE — remove this merchant's QR image (numbers/display stay as-is).
export const DELETE = handler(async (req, ctx: { params: Promise<{ merchantId: string }> }) => {
  requireOwner(await getStaff(req));
  const { merchantId } = await ctx.params;
  const r = await q(
    "UPDATE merchant_accounts SET qr_image = NULL, qr_image_mime = NULL, qr_image_path = NULL, updated_at = now() WHERE id::text = $1 RETURNING id",
    [merchantId]
  );
  if (!r[0]) throw new ApiError(404, "MERCHANT_NOT_FOUND", "Merchant account nahi mila");
  return ok({ removed: true });
});
