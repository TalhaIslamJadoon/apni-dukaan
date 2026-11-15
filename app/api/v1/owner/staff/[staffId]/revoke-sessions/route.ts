import { handler, ok } from "@/server/http";
import { tx, one, ApiError } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";
import { audit } from "@/server/events";

export const dynamic = "force-dynamic";

// POST /api/v1/owner/staff/:staffId/revoke-sessions
export const POST = handler(async (req, ctx: { params: Promise<{ staffId: string }> }) => {
  const owner = requireOwner(await getStaff(req));
  const { staffId } = await ctx.params;
  const u = await one<any>("SELECT * FROM staff_users WHERE legacy_id = $1 OR id::text = $1", [staffId]);
  if (!u) throw new ApiError(404, "STAFF_NOT_FOUND", "Staff member nahi mila");
  await tx(async (c) => {
    await c.query("UPDATE staff_sessions SET revoked_at = now(), revoked_by_staff_id = $2 WHERE staff_user_id = $1 AND revoked_at IS NULL", [u.id, owner.id]);
    await audit(c, { type: "staff", staffId: owner.id }, "staff.revoke_sessions", "staff_user", u.id, {});
  });
  return ok({ revoked: true });
});
