import { handler, ok, body } from "@/server/http";
import { one, ApiError } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";
import { upsertPacking } from "@/server/services/catalogAdmin";

export const dynamic = "force-dynamic";

// POST /api/v1/owner/grocery/products/:productId/packings — convenience:
// adds a packing to the product's Standard (default) variant.
export const POST = handler(async (req, ctx: { params: Promise<{ productId: string }> }) => {
  requireOwner(await getStaff(req));
  const { productId } = await ctx.params;
  const v = await one<any>(
    `SELECT v.id::text AS vid FROM grocery_variants v JOIN grocery_products p ON p.id = v.product_id
     WHERE (p.legacy_id = $1 OR p.id::text = $1) AND v.is_active = true ORDER BY (v.name = 'Standard') DESC, v.sort_order LIMIT 1`,
    [productId]
  );
  if (!v) throw new ApiError(404, "VARIANT_NOT_FOUND", "Product ka default variant nahi mila");
  const b = await body<any>(req);
  return ok(await upsertPacking({ ...b, variantId: v.vid }), 201);
});
