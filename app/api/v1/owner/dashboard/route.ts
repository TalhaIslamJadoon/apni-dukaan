import { handler, ok } from "@/server/http";
import { getStaff, requireOwner } from "@/server/auth";
import { dashboard } from "@/server/services/owner";

export const dynamic = "force-dynamic";

// GET /api/v1/owner/dashboard?date=YYYY-MM-DD — server aggregates (plan §4.3E).
export const GET = handler(async (req) => {
  requireOwner(await getStaff(req));
  const date = new URL(req.url).searchParams.get("date") ?? undefined;
  return ok({ dashboard: await dashboard(date) });
});
