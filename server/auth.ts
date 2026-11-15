// Server-side auth: hashed credentials (bcrypt), opaque cookie sessions
// (only the token hash is stored), lockout after repeated failures.
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { q, one, ApiError } from "./db";

export const STAFF_COOKIE = "pos_staff_session";
export const CUSTOMER_COOKIE = "pos_customer_session";
const MAX_FAILS = 5;
const LOCK_MINUTES = 5;
const SESSION_DAYS = 7;

export const hashCredential = (secret: string) => bcrypt.hash(secret, 10);
export const verifyCredential = (secret: string, hash: string) => bcrypt.compare(secret, hash);

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(name: string, token: string, maxAgeDays = SESSION_DAYS): string {
  const secure = process.env.COOKIE_SECURE === "1" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeDays * 86400}${secure}`;
}
export function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export interface StaffPrincipal {
  kind: "staff";
  id: string;
  legacyId: string | null;
  name: string;
  isOwner: boolean;
  tabs: string[];
  mustChangeCredential: boolean;
  sessionId: string;
}
export interface CustomerPrincipal {
  kind: "customer";
  id: string;
  name: string;
  mobile: string;
  email: string | null;
  emailVerified: boolean; // mandatory gate: unverified accounts cannot order
  mobileVerified: boolean; // optional confirmation — flag only
  placeType: string;
  placeDetail: string;
  externalId: string | null;
  sessionId: string;
}
export type Principal = StaffPrincipal | CustomerPrincipal;

async function createSession(table: "staff_sessions" | "customer_sessions", ownerCol: string, ownerId: string, req: Request): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  const ua = req.headers.get("user-agent") || null;
  await q(
    `INSERT INTO ${table} (${ownerCol}, token_hash, user_agent, expires_at)
     VALUES ($1,$2,$3, now() + ($4 || ' days')::interval)`,
    [ownerId, sha256(token), ua, String(SESSION_DAYS)]
  );
  return token;
}

export async function staffLogin(req: Request, staffId: string, pin: string): Promise<{ principal: StaffPrincipal; cookie: string }> {
  const user = await one<any>("SELECT * FROM staff_users WHERE id = $1", [staffId]);
  if (!user || !user.is_active) throw new ApiError(401, "INVALID_CREDENTIALS", "Naam ya PIN ghalat hai");
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new ApiError(423, "ACCOUNT_LOCKED", "Bohat zyada ghalat koshishen — kuch dair baad try karein");
  }
  const ok = await verifyCredential(pin, user.credential_hash);
  if (!ok) {
    const fails = (user.failed_attempts ?? 0) + 1;
    await q(
      `UPDATE staff_users SET failed_attempts = $2,
         locked_until = CASE WHEN $2 >= $3 THEN now() + ($4 || ' minutes')::interval ELSE locked_until END
       WHERE id = $1`,
      [user.id, fails, MAX_FAILS, String(LOCK_MINUTES)]
    );
    throw new ApiError(401, "INVALID_CREDENTIALS", "Naam ya PIN ghalat hai");
  }
  await q("UPDATE staff_users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1", [user.id]);
  const token = await createSession("staff_sessions", "staff_user_id", user.id, req);
  const principal = await staffPrincipal(user.id);
  if (!principal) throw new ApiError(500, "SESSION_FAILED", "Session nahi ban saka");
  return { principal, cookie: sessionCookie(STAFF_COOKIE, token) };
}

export async function staffPrincipal(staffId: string, sessionId?: string): Promise<StaffPrincipal | null> {
  const user = await one<any>("SELECT * FROM staff_users WHERE id = $1 AND is_active = true", [staffId]);
  if (!user) return null;
  const grants = await q<{ tab_key: string }>("SELECT tab_key FROM staff_tab_grants WHERE staff_user_id = $1", [staffId]);
  return {
    kind: "staff",
    id: user.id,
    legacyId: user.legacy_id,
    name: user.display_name,
    isOwner: !!user.is_owner,
    tabs: grants.map((g) => g.tab_key),
    mustChangeCredential: !!user.must_change_credential,
    sessionId: sessionId ?? "",
  };
}

export async function getStaff(req: Request): Promise<StaffPrincipal | null> {
  const token = parseCookies(req)[STAFF_COOKIE];
  if (!token) return null;
  const sess = await one<any>(
    `SELECT s.id AS sid, s.staff_user_id FROM staff_sessions s
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [sha256(token)]
  );
  if (!sess) return null;
  await q("UPDATE staff_sessions SET last_seen_at = now() WHERE id = $1", [sess.sid]);
  return staffPrincipal(sess.staff_user_id, sess.sid);
}

export async function getCustomer(req: Request): Promise<CustomerPrincipal | null> {
  const token = parseCookies(req)[CUSTOMER_COOKIE];
  if (!token) return null;
  const sess = await one<any>(
    `SELECT s.id AS sid, c.* FROM customer_sessions s JOIN customers c ON c.id = s.customer_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND c.is_active = true`,
    [sha256(token)]
  );
  if (!sess) return null;
  await q("UPDATE customer_sessions SET last_seen_at = now() WHERE id = $1", [sess.sid]);
  return {
    kind: "customer",
    id: sess.id, // c.* ka id = customer id (session id `sid` alias mein hai)
    name: sess.full_name,
    mobile: sess.mobile,
    email: sess.email ?? null,
    emailVerified: !!sess.email_verified,
    mobileVerified: !!sess.mobile_verified,
    placeType: sess.place_type,
    placeDetail: sess.place_detail,
    externalId: sess.external_student_staff_id,
    sessionId: sess.sid,
  };
}

export async function customerLogin(req: Request, mobile: string, password: string): Promise<{ principal: CustomerPrincipal; cookie: string }> {
  const cust = await one<any>("SELECT * FROM customers WHERE mobile = $1", [mobile]);
  if (!cust || !cust.is_active) throw new ApiError(401, "INVALID_CREDENTIALS", "Mobile ya password ghalat hai");
  if (cust.locked_until && new Date(cust.locked_until) > new Date()) {
    throw new ApiError(423, "ACCOUNT_LOCKED", "Bohat zyada ghalat koshishen — kuch dair baad try karein");
  }
  const ok = await verifyCredential(password, cust.password_hash);
  if (!ok) {
    const fails = (cust.failed_attempts ?? 0) + 1;
    await q(
      `UPDATE customers SET failed_attempts = $2,
         locked_until = CASE WHEN $2 >= $3 THEN now() + ($4 || ' minutes')::interval ELSE locked_until END
       WHERE id = $1`,
      [cust.id, fails, MAX_FAILS, String(LOCK_MINUTES)]
    );
    throw new ApiError(401, "INVALID_CREDENTIALS", "Mobile ya password ghalat hai");
  }
  await q("UPDATE customers SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1", [cust.id]);
  const token = await createSession("customer_sessions", "customer_id", cust.id, req);
  const principal = await getCustomer(new Request(req.url, { headers: { cookie: `${CUSTOMER_COOKIE}=${token}` } }));
  if (!principal) throw new ApiError(500, "SESSION_FAILED", "Session nahi ban saka");
  return { principal, cookie: sessionCookie(CUSTOMER_COOKIE, token) };
}

export async function revokeSession(req: Request, who: "staff" | "customer"): Promise<string> {
  const name = who === "staff" ? STAFF_COOKIE : CUSTOMER_COOKIE;
  const table = who === "staff" ? "staff_sessions" : "customer_sessions";
  const token = parseCookies(req)[name];
  if (token) await q(`UPDATE ${table} SET revoked_at = now() WHERE token_hash = $1`, [sha256(token)]);
  return clearCookie(name);
}

export function requireStaff(p: StaffPrincipal | null, tab?: string): StaffPrincipal {
  if (!p) throw new ApiError(401, "NOT_LOGGED_IN", "Staff login zaroori hai");
  if (tab && !p.tabs.includes(tab) && !p.isOwner) throw new ApiError(403, "FORBIDDEN", "Is tab ka access nahi hai");
  if (tab && p.isOwner && !p.tabs.includes(tab)) throw new ApiError(403, "FORBIDDEN", "Is tab ka access nahi hai");
  return p;
}
export function requireOwner(p: StaffPrincipal | null): StaffPrincipal {
  const s = requireStaff(p);
  if (!s.isOwner && !s.tabs.includes("owner")) throw new ApiError(403, "FORBIDDEN", "Sirf Owner ke liye hai");
  return s;
}
export function requireCustomer(p: CustomerPrincipal | null): CustomerPrincipal {
  if (!p) throw new ApiError(401, "NOT_LOGGED_IN", "Customer login zaroori hai");
  return p;
}

// ── Print agent auth (plan §1.5) ─────────────────────────────────────────────
// The Windows print agent authenticates with a bearer token issued once by
// the owner (POST /api/v1/owner/print-agents); only its sha256 hash is stored
// in print_agents.token_hash — the same hash-only pattern as sessions above.
export interface PrintAgentPrincipal {
  kind: "print_agent";
  id: string;
  displayName: string;
}

export async function getPrintAgent(req: Request): Promise<PrintAgentPrincipal | null> {
  const m = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const agent = await one<any>(
    "SELECT * FROM print_agents WHERE token_hash = $1 AND is_active = true",
    [sha256(m[1].trim())]
  );
  if (!agent) return null;
  await q("UPDATE print_agents SET last_seen_at = now() WHERE id = $1", [agent.id]);
  return { kind: "print_agent", id: agent.id, displayName: agent.display_name };
}

export function requirePrintAgent(p: PrintAgentPrincipal | null): PrintAgentPrincipal {
  if (!p) throw new ApiError(401, "AGENT_UNAUTHORIZED", "Print agent token ghalat ya missing hai");
  return p;
}
