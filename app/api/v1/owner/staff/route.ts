import { handler, ok, body } from "@/server/http";
import { tx, ApiError } from "@/server/db";
import { getStaff, requireOwner, hashCredential } from "@/server/auth";
import { fetchStaffDTOs } from "@/server/dto";
import { audit } from "@/server/events";

export const dynamic = "force-dynamic";

const TABS = ["canteen", "grocery", "kitchen", "stock", "owner", "online"];

// GET /api/v1/owner/staff — Staff Access list (no credential material).
export const GET = handler(async (req) => {
  requireOwner(await getStaff(req));
  return ok({ staff: await fetchStaffDTOs() });
});

// POST /api/v1/owner/staff { name, pin, tabs } — create a staff account.
export const POST = handler(async (req) => {
  const owner = requireOwner(await getStaff(req));
  const b = await body<{ name: string; pin: string; tabs: string[] }>(req);
  if (!b.name?.trim() || !b.pin || String(b.pin).length < 4) throw new ApiError(400, "MISSING_FIELDS", "Naam aur kam az kam 4-digit PIN zaroori hai");
  const tabs = (b.tabs ?? []).filter((t) => TABS.includes(t));
  const hash = await hashCredential(String(b.pin));
  const legacy = `staff-${Date.now().toString(36)}`;
  await tx(async (c) => {
    const ins = await c.query(
      "INSERT INTO staff_users (legacy_id, display_name, credential_hash, credential_kind, created_by_staff_id) VALUES ($1,$2,$3,'pin4',$4) RETURNING id",
      [legacy, b.name.trim(), hash, owner.id]
    );
    for (const t of tabs) {
      await c.query("INSERT INTO staff_tab_grants (staff_user_id, tab_key, granted_by_staff_id) VALUES ($1,$2,$3)", [ins.rows[0].id, t, owner.id]);
    }
    await audit(c, { type: "staff", staffId: owner.id }, "staff.create", "staff_user", ins.rows[0].id, { name: b.name, tabs });
  });
  return ok({ staff: await fetchStaffDTOs() }, 201);
});
