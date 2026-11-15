import { handler, ok, body } from "@/server/http";
import { q, ApiError } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";

export const dynamic = "force-dynamic";

// PATCH /api/v1/owner/shops/:shopId (uuid or kind) — rename a shop.
export const PATCH = handler(async (req, ctx: { params: Promise<{ shopId: string }> }) => {
  requireOwner(await getStaff(req));
  const { shopId } = await ctx.params;
  const b = await body<{ displayName: string }>(req);
  if (!b.displayName?.trim()) throw new ApiError(400, "NAME_REQUIRED", "Shop ka naam zaroori hai");
  const r = await q(
    "UPDATE shops SET display_name = $1, updated_at = now() WHERE id::text = $2 OR kind = $2 RETURNING kind, display_name",
    [b.displayName.trim(), shopId]
  );
  if (!r[0]) throw new ApiError(404, "SHOP_NOT_FOUND", "Shop nahi mila");
  return ok({ shop: r[0] });
});
