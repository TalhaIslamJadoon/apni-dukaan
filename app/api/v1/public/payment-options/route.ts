import { handler, ok } from "@/server/http";
import { q } from "@/server/db";
import { shopSettingsDTO } from "@/server/dto";

export const dynamic = "force-dynamic";

// GET /api/v1/public/payment-options — public merchant display data for the
// payment-proof flow. Static official QR assets appear here once Talha's
// merchant accounts are configured (plan §1.4 Level A); the settings numbers
// are the current receiving details. Nothing here confirms a payment.
export const GET = handler(async () => {
  const settings = await shopSettingsDTO();
  const merchants = await q<any>("SELECT provider, display_name, merchant_ref_masked, qr_payload, qr_image_path, qr_mode, (qr_image IS NOT NULL) AS has_qr FROM merchant_accounts WHERE is_active = true");
  return ok({
    numbers: {
      jazzcash: settings.jazzcashNumber,
      easypaisa: settings.easypaisaNumber,
      raast: settings.raastInfo,
    },
    merchants: merchants.map((m) => ({
      provider: m.provider, displayName: m.display_name, refMasked: m.merchant_ref_masked,
      qrPayload: m.qr_payload, qrImagePath: m.qr_image_path, qrMode: m.qr_mode, hasQr: m.has_qr === true,
    })),
  });
});
