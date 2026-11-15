import { handler, ok, body } from "@/server/http";
import { one, ApiError } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";
import { upsertPacking } from "@/server/services/catalogAdmin";

export const dynamic = "force-dynamic";

// POST /api/v1/owner/grocery/products/:productId/variants/:variantName/packings
// Name-addressed convenience for the Owner product form (the catalogue DTO
// exposes variants by name): adds a packing (label, prices, own barcode,
// containsQty, wholesale min) to that variant of the master.
export const POST = handler(async (req, ctx: { params: Promise<{ productId: string; variantName: string }> }) => {
  requireOwner(await getStaff(req));
  const { productId, variantName } = await ctx.params;
  const v = await one<any>(
    `SELECT v.id::text AS vid FROM grocery_variants v JOIN grocery_products p ON p.id = v.product_id
     WHERE (p.legacy_id = $1 OR p.id::text = $1) AND lower(v.name) = lower($2) AND v.is_active = true`,
    [productId, decodeURIComponent(variantName)]
  );
  if (!v) throw new ApiError(404, "VARIANT_NOT_FOUND", "Variant nahi mila — pehle variant add karein");
  const b = await body<any>(req);
  return ok(await upsertPacking({ ...b, variantId: v.vid }), 201);
});
