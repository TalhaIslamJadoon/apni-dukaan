import { handler, ok, body } from "@/server/http";
import { one, ApiError } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";
import { upsertVariant, deleteVariant } from "@/server/services/catalogAdmin";

export const dynamic = "force-dynamic";

export const PATCH = handler(async (req, ctx: { params: Promise<{ variantId: string }> }) => {
  requireOwner(await getStaff(req));
  const { variantId } = await ctx.params;
  const v = await one<any>("SELECT p.legacy_id AS product_legacy FROM grocery_variants v JOIN grocery_products p ON p.id = v.product_id WHERE v.legacy_id = $1 OR v.id::text = $1", [variantId]);
  if (!v) throw new ApiError(404, "VARIANT_NOT_FOUND", "Variant nahi mila");
  const b = await body<{ name: string }>(req);
  return ok(await upsertVariant({ id: variantId, productId: v.product_legacy, name: b.name }));
});

export const DELETE = handler(async (req, ctx: { params: Promise<{ variantId: string }> }) => {
  requireOwner(await getStaff(req));
  const { variantId } = await ctx.params;
  await deleteVariant(variantId);
  return ok({ deleted: true });
});
