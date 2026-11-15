import { handler, ok, body } from "@/server/http";
import { tx, one, ApiError } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";
import { fetchStaffDTOs } from "@/server/dto";
import { audit, emit } from "@/server/events";

export const dynamic = "force-dynamic";

const TABS = ["canteen", "grocery", "kitchen", "stock", "owner", "online"];

// PUT /api/v1/owner/staff/:staffId/grants { tabs } — replace tab grants.
// Protected-owner rule: the owner's Owner grant can never be removed.
export const PUT = handler(async (req, ctx: { params: Promise<{ staffId: string }> }) => {
  const owner = requireOwner(await getStaff(req));
  const { staffId } = await ctx.params;
  const u = await one<any>("SELECT * FROM staff_users WHERE legacy_id = $1 OR id::text = $1", [staffId]);
  if (!u) throw new ApiError(404, "STAFF_NOT_FOUND", "Staff member nahi mila");
  const b = await body<{ tabs: string[] }>(req);
  let tabs = (b.tabs ?? []).filter((t) => TABS.includes(t));
  if (u.is_owner && !tabs.includes("owner")) throw new ApiError(409, "OWNER_PROTECTED", "Owner ka Owner tab nahi hataya ja sakta");
  await tx(async (c) => {
    await c.query("DELETE FROM staff_tab_grants WHERE staff_user_id = $1", [u.id]);
    for (const t of tabs) {
      await c.query("INSERT INTO staff_tab_grants (staff_user_id, tab_key, granted_by_staff_id) VALUES ($1,$2,$3)", [u.id, t, owner.id]);
    }
    await emit(c, "staff.changed", "staff_user", u.id, {});
    await audit(c, { type: "staff", staffId: owner.id }, "staff.grants", "staff_user", u.id, { tabs });
  });
  return ok({ staff: await fetchStaffDTOs() });
});
