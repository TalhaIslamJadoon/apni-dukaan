import { handler, ok, body } from "@/server/http";
import { tx, one, ApiError } from "@/server/db";
import { getStaff, requireOwner, hashCredential } from "@/server/auth";
import { fetchStaffDTOs } from "@/server/dto";
import { audit } from "@/server/events";

export const dynamic = "force-dynamic";

async function resolve(id: string) {
  const u = await one<any>("SELECT * FROM staff_users WHERE legacy_id = $1 OR id::text = $1", [id]);
  if (!u) throw new ApiError(404, "STAFF_NOT_FOUND", "Staff member nahi mila");
  return u;
}

// PATCH — rename, change PIN (only when a new PIN value is supplied),
// activate/deactivate. The protected-owner rule is enforced: the owner can
// never be deactivated.
export const PATCH = handler(async (req, ctx: { params: Promise<{ staffId: string }> }) => {
  const owner = requireOwner(await getStaff(req));
  const { staffId } = await ctx.params;
  const u = await resolve(staffId);
  const b = await body<{ name?: string; pin?: string; isActive?: boolean }>(req);
  if (u.is_owner && b.isActive === false) throw new ApiError(409, "OWNER_PROTECTED", "Owner ko deactivate nahi kar sakte");
  await tx(async (c) => {
    if (b.name?.trim()) await c.query("UPDATE staff_users SET display_name = $2, updated_at = now() WHERE id = $1", [u.id, b.name.trim()]);
    if (b.pin && String(b.pin).length >= 4) {
      const hash = await hashCredential(String(b.pin));
      await c.query("UPDATE staff_users SET credential_hash = $2, must_change_credential = false, updated_at = now() WHERE id = $1", [u.id, hash]);
    }
    if (b.isActive !== undefined) await c.query("UPDATE staff_users SET is_active = $2, updated_at = now() WHERE id = $1", [u.id, b.isActive]);
    await audit(c, { type: "staff", staffId: owner.id }, "staff.update", "staff_user", u.id, { name: b.name, isActive: b.isActive, pinChanged: !!b.pin });
  });
  return ok({ staff: await fetchStaffDTOs() });
});

// DELETE — deactivate (staff with history are never hard-deleted, plan §3.6).
export const DELETE = handler(async (req, ctx: { params: Promise<{ staffId: string }> }) => {
  const owner = requireOwner(await getStaff(req));
  const { staffId } = await ctx.params;
  const u = await resolve(staffId);
  if (u.is_owner) throw new ApiError(409, "OWNER_PROTECTED", "Owner ko delete nahi kar sakte");
  await tx(async (c) => {
    await c.query("UPDATE staff_users SET is_active = false, updated_at = now() WHERE id = $1", [u.id]);
    await c.query("UPDATE staff_sessions SET revoked_at = now() WHERE staff_user_id = $1 AND revoked_at IS NULL", [u.id]);
    await audit(c, { type: "staff", staffId: owner.id }, "staff.deactivate", "staff_user", u.id, {});
  });
  return ok({ staff: await fetchStaffDTOs() });
});
