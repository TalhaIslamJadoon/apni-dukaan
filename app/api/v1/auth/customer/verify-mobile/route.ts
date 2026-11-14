import { handler, ok, body } from "@/server/http";
import { getCustomer, requireCustomer } from "@/server/auth";
import { verifyCode } from "@/server/services/verification";

export const dynamic = "force-dynamic";

// POST /api/v1/auth/customer/verify-mobile { code } — OPTIONAL mobile
// confirmation (customer Skip bhi kar sakta hai; verified mobile sirf ek
// flag ke tor par save hota hai).
export const POST = handler(async (req) => {
  const p = requireCustomer(await getCustomer(req));
  const b = await body<{ code: string }>(req);
  await verifyCode(p.id, "mobile", b.code ?? "");
  const fresh = requireCustomer(await getCustomer(req));
  return ok({ verified: true, emailVerified: fresh.emailVerified, mobileVerified: fresh.mobileVerified });
});
