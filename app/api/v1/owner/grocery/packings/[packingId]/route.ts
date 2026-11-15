import { handler, ok, body } from "@/server/http";
import { one, ApiError } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";
import { upsertPacking, deletePacking } from "@/server/services/catalogAdmin";

export const dynamic = "force-dynamic";

export const PATCH = handler(async (req, ctx: { params: Promise<{ packingId: string }> }) => {
  requireOwner(await getStaff(req));
  const { packingId } = await ctx.params;
  const pk = await one<any>(
    `SELECT v.id::text AS vid FROM grocery_packings pk JOIN grocery_variants v ON v.id = pk.variant_id WHERE pk.id::text = $1`,
    [packingId]
  );
  if (!pk) throw new ApiError(404, "PACKING_NOT_FOUND", "Packing nahi mili");
  const b = await body<any>(req);
  return ok(await upsertPacking({ ...b, id: packingId, variantId: pk.vid }));
});

export const DELETE = handler(async (req, ctx: { params: Promise<{ packingId: string }> }) => {
  requireOwner(await getStaff(req));
  const { packingId } = await ctx.params;
  await deletePacking(packingId);
  return ok({ deleted: true });
});
