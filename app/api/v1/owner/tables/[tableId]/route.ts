import { handler, ok, body } from "@/server/http";
import { q, ApiError } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";

export const dynamic = "force-dynamic";

// PATCH /api/v1/owner/tables/:tableId { label?, isActive? }
export const PATCH = handler(async (req, ctx: { params: Promise<{ tableId: string }> }) => {
  requireOwner(await getStaff(req));
  const { tableId } = await ctx.params;
  const b = await body<{ label?: string; isActive?: boolean }>(req);
  const r = await q(
    `UPDATE dining_tables SET label = COALESCE($2, label), is_active = COALESCE($3, is_active), updated_at = now()
     WHERE id::text = $1 RETURNING id`,
    [tableId, b.label ?? null, b.isActive ?? null]
  );
  if (!r[0]) throw new ApiError(404, "TABLE_NOT_FOUND", "Table nahi mila");
  return ok({ updated: true });
});
