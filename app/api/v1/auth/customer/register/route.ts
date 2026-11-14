import { handler, ok, body } from "@/server/http";
import { q, one, ApiError } from "@/server/db";
import { hashCredential, customerLogin } from "@/server/auth";
import { issueCode } from "@/server/services/verification";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/v1/auth/customer/register — remote customers only (plan §1.3).
// Mobile is the unique login ID; student/staff ID stays optional (Udhaar).
// EMAIL lazmi hai (Talha, 15 Nov 2026): account banta hai lekin email code
// confirm hone tak INACTIVE rehta hai — login ho sakta hai, order nahi.
// Response `verification.emailDelivery` delivery ki asal halat batata hai
// (NOT_CONFIGURED = deployment par SMTP configure hone par codes jayenge).
export const POST = handler(async (req) => {
  const b = await body<{ name: string; mobile: string; password: string; email: string; placeType: string; placeDetail: string; studentId?: string }>(req);
  if (!b.name?.trim() || !b.mobile?.trim() || !b.password) throw new ApiError(400, "MISSING_FIELDS", "Naam, mobile aur password zaroori hain");
  if (!b.email?.trim() || !EMAIL_RE.test(b.email.trim())) throw new ApiError(400, "EMAIL_REQUIRED", "Sahi email address zaroori hai — confirmation code usi par jayega");
  if (!["Hostel Room", "Office", "Other"].includes(b.placeType)) throw new ApiError(400, "BAD_PLACE_TYPE", "Place type ghalat hai");
  const mobile = b.mobile.trim();
  const email = b.email.trim().toLowerCase();
  const exists = await one("SELECT id FROM customers WHERE mobile = $1", [mobile]);
  if (exists) throw new ApiError(409, "MOBILE_EXISTS", "Is mobile par account pehle se hai — login karein");
  const hash = await hashCredential(b.password);
  const ins = await q<{ id: string }>(
    `INSERT INTO customers (full_name, mobile, password_hash, email, email_verified, place_type, place_detail, external_student_staff_id)
     VALUES ($1,$2,$3,$4,false,$5,$6,$7) RETURNING id`,
    [b.name.trim(), mobile, hash, email, b.placeType, b.placeDetail ?? "", b.studentId?.trim() || null]
  );
  // Pehla email code foran issue karein (delivery state honestly reported).
  const issued = await issueCode({ id: ins[0].id, email, mobile }, "email");
  const { principal, cookie } = await customerLogin(req, mobile, b.password);
  return ok({
    account: {
      name: principal.name, mobile: principal.mobile, email: principal.email,
      emailVerified: principal.emailVerified, mobileVerified: principal.mobileVerified,
      placeType: principal.placeType,
      placeDetail: principal.placeDetail, ...(principal.externalId ? { studentId: principal.externalId } : {}),
    },
    verification: { emailDelivery: issued.delivery, expiresInMinutes: issued.expiresInMinutes },
  }, 201, { "set-cookie": cookie });
});
