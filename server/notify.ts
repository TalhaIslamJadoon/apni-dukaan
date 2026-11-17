// ─────────────────────────────────────────────────────────────────────────────
// Notification senders — account-verification code delivery (Talha's final
// design, 15 Nov 2026). HONESTY RULE: a sender that is not configured says
// so — it returns { delivered: false, state: "NOT_CONFIGURED" } and the UI
// tells the customer codes will be delivered once email/SMS is configured
// at deployment. Nothing here ever pretends a code was sent when it wasn't.
//
// Email: SMTP via env — SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
// SMTP_FROM (nodemailer). SMS: a provider HTTP endpoint via env —
// SMS_API_URL + SMS_API_KEY (POST JSON {to, message, apiKey}); any
// Pakistani SMS gateway with that shape can be wired at deployment.
//
// Dev fallback: when a sender is NOT configured AND NODE_ENV is not
// "production", the code is written to the server console with a clear
// [DEV-OTP] prefix so local testing can complete the flow. Production
// never logs codes.
// ─────────────────────────────────────────────────────────────────────────────
import nodemailer from "nodemailer";

export type SendState = "sent" | "NOT_CONFIGURED" | "FAILED";
export interface SendResult {
  delivered: boolean;
  state: SendState;
  detail?: string;
}

const isProd = () => process.env.NODE_ENV === "production";

function devLog(channel: "email" | "mobile", to: string, code: string) {
  if (isProd()) return;
  // Clearly a DEV fallback — production delivers via SMTP/SMS only.
  console.log(`[DEV-OTP] ${channel} code for ${to}: ${code} (sender NOT configured — dev console fallback)`);
}

export function emailConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_FROM);
}
export function smsConfigured(): boolean {
  return !!(process.env.SMS_API_URL && process.env.SMS_API_KEY);
}

export async function sendEmailCode(to: string, code: string): Promise<SendResult> {
  if (!emailConfigured()) {
    devLog("email", to, code);
    return { delivered: false, state: "NOT_CONFIGURED", detail: "SMTP not configured" };
  }
  try {
    const port = Number(process.env.SMTP_PORT || 587);
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject: "Apni Dukaan — Email Confirmation Code",
      text: `Aap ka email confirmation code hai: ${code}\n\nYe code 10 minute ke liye valid hai. Agar aap ne account nahi banaya to is email ko nazar-andaz kar dein.\n\n— College Canteen & Campus Grocery Store`,
    });
    return { delivered: true, state: "sent" };
  } catch (e) {
    console.error("[notify] email send failed:", e);
    return { delivered: false, state: "FAILED", detail: String(e).slice(0, 200) };
  }
}

export async function sendSmsCode(to: string, code: string): Promise<SendResult> {
  if (!smsConfigured()) {
    devLog("mobile", to, code);
    return { delivered: false, state: "NOT_CONFIGURED", detail: "SMS provider not configured" };
  }
  try {
    const res = await fetch(process.env.SMS_API_URL as string, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.SMS_API_KEY}` },
      body: JSON.stringify({
        to,
        message: `Apni Dukaan: aap ka mobile confirmation code hai ${code}. Ye code 10 minute ke liye valid hai.`,
        apiKey: process.env.SMS_API_KEY,
      }),
    });
    if (!res.ok) return { delivered: false, state: "FAILED", detail: `SMS provider HTTP ${res.status}` };
    return { delivered: true, state: "sent" };
  } catch (e) {
    console.error("[notify] sms send failed:", e);
    return { delivered: false, state: "FAILED", detail: String(e).slice(0, 200) };
  }
}
