import { handler, ok, body } from "@/server/http";
import { q, one, ApiError } from "@/server/db";
import { getStaff, requireStaff, hashCredential, verifyCredential } from "@/server/auth";

export const dynamic = "force-dynamic";

// POST /api/v1/auth/staff/change-credential { current, next }
export const POST = handler(async (req) => {
  const p = requireStaff(await getStaff(req));
  const b = await body<{ current: string; next: string }>(req);
  if (!b.next || String(b.next).length < 4) throw new ApiError(400, "WEAK_CREDENTIAL", "Naya PIN kam az kam 4 digits ka ho");
  const user = await one<any>("SELECT * FROM staff_users WHERE id = $1", [p.id]);
  if (!(await verifyCredential(String(b.current ?? ""), user.credential_hash))) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Purana PIN ghalat hai");
  }
  const hash = await hashCredential(String(b.next));
  await q("UPDATE staff_users SET credential_hash = $2, credential_kind = $3, must_change_credential = false, updated_at = now() WHERE id = $1",
    [p.id, hash, /^\d{4}$/.test(String(b.next)) ? "pin4" : "password"]);
  return ok({ changed: true });
});
