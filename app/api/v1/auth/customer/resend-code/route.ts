import { handler, ok, body } from "@/server/http";
import { ApiError } from "@/server/db";
import { getCustomer, requireCustomer } from "@/server/auth";
import { issueCode, type OtpChannel } from "@/server/services/verification";

export const dynamic = "force-dynamic";

// POST /api/v1/auth/customer/resend-code { channel: "email" | "mobile" }
// — naya code bhejein (60s cooldown). Response delivery ki ASAL halat
// batata hai: state "NOT_CONFIGURED" matlab code abhi deliver nahi ho
// sakta (deployment par email/SMS configure hoga) — jhooti "bhej diya"
// kabhi nahi kaha jata.
export const POST = handler(async (req) => {
  const p = requireCustomer(await getCustomer(req));
  const b = await body<{ channel: OtpChannel }>(req);
  if (b.channel !== "email" && b.channel !== "mobile") throw new ApiError(400, "BAD_CHANNEL", "channel email ya mobile hona chahiye");
  if (b.channel === "email" && !p.email) throw new ApiError(400, "NO_EMAIL", "Is account par email nahi hai");
  const r = await issueCode({ id: p.id, email: p.email, mobile: p.mobile }, b.channel);
  return ok({ channel: r.channel, delivery: r.delivery, expiresInMinutes: r.expiresInMinutes });
});
