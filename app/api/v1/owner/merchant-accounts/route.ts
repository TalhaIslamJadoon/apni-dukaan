import { handler, ok, body } from "@/server/http";
import { q, ApiError } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";

export const dynamic = "force-dynamic";

// Merchant accounts (plan §1.4): Talha's OFFICIAL provider QR data lives
// here — display name, masked reference, official static payload/image.
// API secrets are NEVER stored in or returned from this table.

export const GET = handler(async (req) => {
  requireOwner(await getStaff(req));
  const rows = await q<any>(
    "SELECT id, shop_id, provider, display_name, merchant_ref_masked, qr_payload, qr_image_path, qr_mode, is_active, config_notes, updated_at, (qr_image IS NOT NULL) AS has_qr FROM merchant_accounts ORDER BY created_at"
  );
  return ok({
    merchants: rows.map((m) => ({
      id: m.id, provider: m.provider, displayName: m.display_name, refMasked: m.merchant_ref_masked,
      qrPayload: m.qr_payload, qrImagePath: m.qr_image_path, qrMode: m.qr_mode, isActive: m.is_active,
      configNotes: m.config_notes, shopId: m.shop_id, hasQr: m.has_qr === true,
      updatedAt: m.updated_at ? new Date(m.updated_at).toISOString() : null,
    })),
  });
});

export const POST = handler(async (req) => {
  requireOwner(await getStaff(req));
  const b = await body<any>(req);
  if (!["jazzcash", "easypaisa", "raast", "bank", "other"].includes(b.provider)) throw new ApiError(400, "BAD_PROVIDER", "Provider ghalat hai");
  if (!b.displayName?.trim()) throw new ApiError(400, "NAME_REQUIRED", "Merchant display name zaroori hai");
  const ins = await q<{ id: string }>(
    `INSERT INTO merchant_accounts (shop_id, provider, display_name, merchant_ref_masked, qr_payload, qr_image_path, qr_mode, config_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [b.shopId ?? null, b.provider, b.displayName.trim(), b.refMasked ?? null, b.qrPayload ?? null, b.qrImagePath ?? null, b.qrMode ?? "static", b.configNotes ?? null]
  );
  return ok({ id: ins[0].id }, 201);
});
