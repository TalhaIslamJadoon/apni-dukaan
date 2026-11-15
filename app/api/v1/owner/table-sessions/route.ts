import { handler, ok } from "@/server/http";
import { q } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";
import { sessionDTO } from "@/server/services/owner";

export const dynamic = "force-dynamic";

// GET /api/v1/owner/table-sessions?status=open — running table bills.
export const GET = handler(async (req) => {
  requireOwner(await getStaff(req));
  const status = new URL(req.url).searchParams.get("status") ?? "open";
  const rows = await q<any>("SELECT id FROM table_sessions WHERE status = $1 ORDER BY opened_at DESC LIMIT 100", [status]);
  const sessions = [];
  for (const r of rows) sessions.push(await sessionDTO(r.id));
  return ok({ sessions });
});
