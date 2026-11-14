import { handler, ok, body } from "@/server/http";
import { one, ApiError } from "@/server/db";
import { staffLogin } from "@/server/auth";
import { staffDTO } from "@/server/dto";

export const dynamic = "force-dynamic";

// POST /api/v1/auth/staff/login { staffId (legacy id or uuid), pin }
export const POST = handler(async (req) => {
  const b = await body<{ staffId: string; pin: string }>(req);
  if (!b.staffId || !b.pin) throw new ApiError(400, "MISSING_FIELDS", "Naam aur PIN zaroori hai");
  const user = await one<any>("SELECT id FROM staff_users WHERE legacy_id = $1 OR id::text = $1", [b.staffId]);
  if (!user) throw new ApiError(401, "INVALID_CREDENTIALS", "Naam ya PIN ghalat hai");
  const { principal, cookie } = await staffLogin(req, user.id, String(b.pin));
  const full = await one<any>("SELECT * FROM staff_users WHERE id = $1", [user.id]);
  return ok({ member: staffDTO(full, principal.tabs), principal }, 200, { "set-cookie": cookie });
});
