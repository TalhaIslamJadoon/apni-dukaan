// ─────────────────────────────────────────────────────────────────────────────
// Account verification (Talha's final design, 15 Nov 2026):
//   • EMAIL code — MANDATORY. The account stays unverified (and cannot
//     order — createOrder rejects unverified customer actors) until the
//     6-digit email code is confirmed.
//   • MOBILE code — OPTIONAL, offered with a Skip; a confirmed mobile is
//     stored as the mobile_verified flag.
// Codes: 6 digits, stored SHA-256 hashed (code + customer id), 10-minute
// expiry, max 5 attempts per code, 60-second resend cooldown. Delivery
// goes through server/notify.ts and its result is reported honestly —
// NOT_CONFIGURED is surfaced to the client, never hidden.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "node:crypto";
import { q, one, ApiError } from "../db";
import { sendEmailCode, sendSmsCode, type SendResult } from "../notify";

export type OtpChannel = "email" | "mobile";
const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

const hashCode = (customerId: string, code: string) =>
  crypto.createHash("sha256").update(`${customerId}:${code}`).digest("hex");

export interface IssueResult {
  channel: OtpChannel;
  delivery: SendResult;
  expiresInMinutes: number;
}

/** Issue (or re-issue) a code for a channel. Enforces the resend cooldown. */
export async function issueCode(
  customer: { id: string; email: string | null; mobile: string },
  channel: OtpChannel
): Promise<IssueResult> {
  const last = await one<{ created_at: string }>(
    "SELECT created_at FROM verification_codes WHERE customer_id = $1 AND channel = $2 ORDER BY created_at DESC LIMIT 1",
    [customer.id, channel]
  );
  if (last) {
    const ageSec = (Date.now() - new Date(last.created_at).getTime()) / 1000;
    if (ageSec < RESEND_COOLDOWN_SECONDS) {
      throw new ApiError(429, "RESEND_COOLDOWN", `Code abhi bheja gaya hai — ${Math.ceil(RESEND_COOLDOWN_SECONDS - ageSec)} second baad dobara try karein`,
        { retryAfterSeconds: Math.ceil(RESEND_COOLDOWN_SECONDS - ageSec) });
    }
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  // A fresh code supersedes every earlier unconsumed code on this channel.
  await q("UPDATE verification_codes SET consumed_at = now() WHERE customer_id = $1 AND channel = $2 AND consumed_at IS NULL", [customer.id, channel]);
  await q(
    `INSERT INTO verification_codes (customer_id, channel, code_hash, expires_at)
     VALUES ($1,$2,$3, now() + ($4 || ' minutes')::interval)`,
    [customer.id, channel, hashCode(customer.id, code), String(CODE_TTL_MINUTES)]
  );
  const delivery = channel === "email"
    ? await sendEmailCode(customer.email ?? "", code)
    : await sendSmsCode(customer.mobile, code);
  return { channel, delivery, expiresInMinutes: CODE_TTL_MINUTES };
}

/** Verify a code. On success the channel's verified flag is set. */
export async function verifyCode(customerId: string, channel: OtpChannel, code: string): Promise<{ verified: true }> {
  if (!/^\d{6}$/.test(code.trim())) throw new ApiError(400, "BAD_CODE", "Code 6 digits ka hona chahiye");
  const row = await one<any>(
    `SELECT * FROM verification_codes WHERE customer_id = $1 AND channel = $2 AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [customerId, channel]
  );
  if (!row) throw new ApiError(400, "NO_CODE", "Koi active code nahi hai — pehle naya code mangwayein");
  if (new Date(row.expires_at) < new Date()) throw new ApiError(400, "CODE_EXPIRED", "Code ki muddat khatam ho gayi hai — naya code mangwayein");
  if (Number(row.attempts) >= MAX_ATTEMPTS) throw new ApiError(429, "TOO_MANY_ATTEMPTS", "Bohat zyada ghalat koshishen — naya code mangwayein");
  const ok = hashCode(customerId, code.trim()) === row.code_hash;
  if (!ok) {
    await q("UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1", [row.id]);
    const left = MAX_ATTEMPTS - (Number(row.attempts) + 1);
    throw new ApiError(400, "WRONG_CODE", `Code ghalat hai${left > 0 ? ` — ${left} koshishen baqi hain` : " — ab naya code mangwayein"}`);
  }
  await q("UPDATE verification_codes SET consumed_at = now() WHERE id = $1", [row.id]);
  await q(
    channel === "email"
      ? "UPDATE customers SET email_verified = true, updated_at = now() WHERE id = $1"
      : "UPDATE customers SET mobile_verified = true, updated_at = now() WHERE id = $1",
    [customerId]
  );
  return { verified: true };
}
