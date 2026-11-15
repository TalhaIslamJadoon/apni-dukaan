import { handler } from "@/server/http";
import { q, ApiError } from "@/server/db";

export const dynamic = "force-dynamic";

// GET /api/v1/public/merchant-qr/[provider] — the merchant's official QR
// image for one payment method (jazzcash | easypaisa | raast | bank), shown
// large on the customer payment step. A payment QR is meant to be public —
// it already hangs as a poster in the shop. 404 while no QR is uploaded.
export const GET = handler(async (_req, ctx: { params: Promise<{ provider: string }> }) => {
  const { provider } = await ctx.params;
  const rows = await q<any>(
    "SELECT qr_image, qr_image_mime FROM merchant_accounts WHERE provider = $1 AND is_active = true AND qr_image IS NOT NULL ORDER BY updated_at DESC LIMIT 1",
    [provider]
  );
  if (!rows[0]) throw new ApiError(404, "QR_NOT_FOUND", "Is method ka QR nahi laga hua");
  return new Response(new Uint8Array(rows[0].qr_image as Buffer), {
    headers: {
      "content-type": rows[0].qr_image_mime ?? "image/png",
      "cache-control": "public, max-age=300",
    },
  });
});
