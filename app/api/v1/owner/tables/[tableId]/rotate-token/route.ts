import { handler, ok } from "@/server/http";
import { q, ApiError } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";
import { newTableToken } from "@/server/services/owner";

export const dynamic = "force-dynamic";

// POST /api/v1/owner/tables/:tableId/rotate-token — invalidates old printed
// cards; the new raw token is returned once for reprinting.
export const POST = handler(async (req, ctx: { params: Promise<{ tableId: string }> }) => {
  requireOwner(await getStaff(req));
  const { tableId } = await ctx.params;
  const t = newTableToken();
  const r = await q("UPDATE dining_tables SET public_token_hash = $2, updated_at = now() WHERE id::text = $1 RETURNING id", [tableId, t.hash]);
  if (!r[0]) throw new ApiError(404, "TABLE_NOT_FOUND", "Table nahi mila");
  return ok({ qrToken: t.raw });
});
