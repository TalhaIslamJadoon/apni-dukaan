import { handler, ok } from "@/server/http";
import { one, ApiError } from "@/server/db";
import { getStaff, requireStaff } from "@/server/auth";
import { fetchGroceryDTOs } from "@/server/dto";

export const dynamic = "force-dynamic";

// GET /api/v1/staff/grocery/lookup?code=... — server fallback for the counter
// scanner. Lookup order (Phase 1 rule): packing barcode → product barcode →
// SKU.
export const GET = handler(async (req) => {
  requireStaff(await getStaff(req), "grocery");
  const code = new URL(req.url).searchParams.get("code")?.trim();
  if (!code) throw new ApiError(400, "CODE_REQUIRED", "Code zaroori hai");
  let legacy: string | null = null;
  let packingLabel: string | null = null;
  const byPacking = await one<any>(
    `SELECT p.legacy_id, pk.label FROM grocery_packings pk
     JOIN grocery_variants v ON v.id = pk.variant_id
     JOIN grocery_products p ON p.id = v.product_id
     WHERE pk.barcode = $1 AND pk.is_active = true AND p.is_active = true`,
    [code]
  );
  if (byPacking) { legacy = byPacking.legacy_id; packingLabel = byPacking.label; }
  if (!legacy) {
    const byBarcode = await one<any>("SELECT legacy_id FROM grocery_products WHERE barcode = $1 AND is_active = true", [code]);
    if (byBarcode) legacy = byBarcode.legacy_id;
  }
  if (!legacy) {
    const bySku = await one<any>("SELECT legacy_id FROM grocery_products WHERE sku = $1 AND is_active = true", [code]);
    if (bySku) legacy = bySku.legacy_id;
  }
  if (!legacy) throw new ApiError(404, "NOT_FOUND", "Is code par koi product nahi mila");
  const { items } = await fetchGroceryDTOs(true);
  const item = (items as any[]).find((i) => i.id === legacy);
  return ok({ item, ...(packingLabel ? { packingLabel } : {}) });
});
