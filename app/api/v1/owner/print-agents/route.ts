import crypto from "node:crypto";
import { handler, ok, body } from "@/server/http";
import { q, ApiError } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";

export const dynamic = "force-dynamic";

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

const dto = (a: any) => ({
  id: a.id,
  displayName: a.display_name,
  machineName: a.machine_name ?? null,
  version: a.version ?? null,
  lastSeenAt: a.last_seen_at ? new Date(a.last_seen_at).toISOString() : null,
  isActive: !!a.is_active,
  hasToken: !!a.token_hash,
});

// GET /api/v1/owner/print-agents — paired print agents (plan §1.5, §1.8).
export const GET = handler(async (req) => {
  requireOwner(await getStaff(req));
  const rows = await q<any>("SELECT * FROM print_agents ORDER BY display_name");
  return ok({ agents: rows.map(dto) });
});

// POST /api/v1/owner/print-agents { displayName, machineName?, version? }
// Pairs a new print agent: generates the agent's bearer token and returns it
// EXACTLY ONCE (only the sha256 hash is stored). Re-issuing for the same
// display name replaces the old token (the old agent stops working).
export const POST = handler(async (req) => {
  requireOwner(await getStaff(req));
  const b = await body<{ displayName?: string; machineName?: string; version?: string }>(req);
  const displayName = (b.displayName || "").trim();
  if (!displayName) throw new ApiError(400, "NAME_REQUIRED", "Print agent ka naam zaroori hai");
  const token = crypto.randomBytes(32).toString("hex");
  const existing = await q<any>("SELECT id FROM print_agents WHERE display_name = $1", [displayName]);
  let row: any;
  if (existing[0]) {
    row = (await q<any>(
      `UPDATE print_agents SET token_hash = $2, machine_name = COALESCE($3, machine_name),
         version = COALESCE($4, version), is_active = true WHERE id = $1 RETURNING *`,
      [existing[0].id, sha256(token), b.machineName ?? null, b.version ?? null]
    ))[0];
  } else {
    row = (await q<any>(
      `INSERT INTO print_agents (display_name, machine_name, token_hash, version)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [displayName, b.machineName ?? null, sha256(token), b.version ?? null]
    ))[0];
  }
  return ok({ agent: dto(row), token, note: "Ye token sirf ek dafa dikhaya jata hai — print agent ki config mein abhi save karein." }, 201);
});
