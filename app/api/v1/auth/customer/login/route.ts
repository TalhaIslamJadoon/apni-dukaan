import { handler, ok, body } from "@/server/http";
import { ApiError } from "@/server/db";
import { customerLogin } from "@/server/auth";

export const dynamic = "force-dynamic";

// POST /api/v1/auth/customer/login { mobile, password }
// Login hamesha ho sakta hai; agar email abhi confirm nahi hua to response
// mein emailVerified=false ata hai aur UI verification screen dikhati hai
// (order server par bhi block hai — EMAIL_NOT_VERIFIED).
export const POST = handler(async (req) => {
  const b = await body<{ mobile: string; password: string }>(req);
  if (!b.mobile || !b.password) throw new ApiError(400, "MISSING_FIELDS", "Mobile aur password zaroori hain");
  const { principal, cookie } = await customerLogin(req, b.mobile.trim(), b.password);
  return ok({
    account: {
      name: principal.name, mobile: principal.mobile, email: principal.email,
      emailVerified: principal.emailVerified, mobileVerified: principal.mobileVerified,
      placeType: principal.placeType,
      placeDetail: principal.placeDetail, ...(principal.externalId ? { studentId: principal.externalId } : {}),
    },
  }, 200, { "set-cookie": cookie });
});
