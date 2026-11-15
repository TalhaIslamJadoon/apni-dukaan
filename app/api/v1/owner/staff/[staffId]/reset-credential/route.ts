import { handler, ok, body } from "@/server/http";
import { tx, one, ApiError } from "@/server/db";
import { getStaff, requireOwner, hashCredential } from "@/server/auth";
import { audit } from "@/server/events";

export const dynamic = "force-dynamic";

// POST /api/v1/owner/staff/:staffId/reset-credential { pin } — owner sets a
// temporary PIN; the member must change it (must_change_credential) and all
// their other sessions are revoked.
export const POST = handler(async (req, ctx: { params: Promise<{ staffId: string }> }) => {
  const owner = requireOwner(await getStaff(req));
  const { staffId } = await ctx.params;
  const u = await one<any>("SELECT * FROM staff_users WHERE legacy_id = $1 OR id::text = $1", [staffId]);
  if (!u) throw new ApiError(404, "STAFF_NOT_FOUND", "Staff member nahi mila");
  const b = await body<{ pin: string }>(req);
  if (!b.pin || String(b.pin).length < 4) throw new ApiError(400, "WEAK_CREDENTIAL", "Temporary PIN kam az kam 4 digits ka ho");
  const hash = await hashCredential(String(b.pin));
  await tx(async (c) => {
    await c.query(
      "UPDATE staff_users SET credential_hash = $2, must_change_credential = true, failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1",
      [u.id, hash]
    );
    await c.query("UPDATE staff_sessions SET revoked_at = now(), revoked_by_staff_id = $2 WHERE staff_user_id = $1 AND revoked_at IS NULL", [u.id, owner.id]);
    await audit(c, { type: "staff", staffId: owner.id }, "staff.reset_credential", "staff_user", u.id, {});
  });
  return ok({ reset: true });
});
