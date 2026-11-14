import { handler, ok } from "@/server/http";
import { q } from "@/server/db";

export const dynamic = "force-dynamic";

// GET /api/v1/auth/staff/list — PUBLIC login-card data only: names + tabs.
// No credential material of any kind is returned.
export const GET = handler(async () => {
  const users = await q<any>("SELECT * FROM staff_users WHERE is_active = true ORDER BY is_owner DESC, created_at ASC");
  const out = [];
  for (const u of users) {
    const grants = await q<{ tab_key: string }>("SELECT tab_key FROM staff_tab_grants WHERE staff_user_id = $1", [u.id]);
    out.push({
      id: u.legacy_id ?? u.id,
      uuid: u.id,
      name: u.display_name,
      pin: "",
      tabs: grants.map((g) => g.tab_key),
      ...(u.is_owner ? { isOwner: true } : {}),
    });
  }
  return ok({ staff: out });
});
