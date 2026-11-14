import { handler, ok } from "@/server/http";
import { one, ApiError } from "@/server/db";
import { getStaff } from "@/server/auth";
import { staffDTO } from "@/server/dto";

export const dynamic = "force-dynamic";

// GET /api/v1/auth/staff/me — current member + grants (StaffGate/TopBar).
export const GET = handler(async (req) => {
  const p = await getStaff(req);
  if (!p) throw new ApiError(401, "NOT_LOGGED_IN", "Staff login zaroori hai");
  const full = await one<any>("SELECT * FROM staff_users WHERE id = $1", [p.id]);
  return ok({ member: staffDTO(full, p.tabs), principal: p });
});
