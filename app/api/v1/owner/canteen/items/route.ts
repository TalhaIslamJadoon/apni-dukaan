import { handler, ok, body } from "@/server/http";
import { getStaff, requireOwner } from "@/server/auth";
import { upsertMenuItem } from "@/server/services/catalogAdmin";

export const dynamic = "force-dynamic";

// POST /api/v1/owner/canteen/items — create a menu item.
export const POST = handler(async (req) => {
  const staff = requireOwner(await getStaff(req));
  const input = await body<any>(req);
  const r = await upsertMenuItem(input, staff);
  return ok(r, 201);
});
