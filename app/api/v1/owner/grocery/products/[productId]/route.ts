import { handler, ok, body } from "@/server/http";
import { getStaff, requireOwner } from "@/server/auth";
import { upsertProduct, deleteProduct, type ProductInput } from "@/server/services/catalogAdmin";

export const dynamic = "force-dynamic";

export const PATCH = handler(async (req, ctx: { params: Promise<{ productId: string }> }) => {
  const staff = requireOwner(await getStaff(req));
  const { productId } = await ctx.params;
  const input = await body<ProductInput>(req);
  return ok(await upsertProduct({ ...input, id: productId }, staff));
});

export const DELETE = handler(async (req, ctx: { params: Promise<{ productId: string }> }) => {
  requireOwner(await getStaff(req));
  const { productId } = await ctx.params;
  await deleteProduct(productId);
  return ok({ deleted: true });
});
