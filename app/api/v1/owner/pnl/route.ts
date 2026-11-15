import { handler, ok } from "@/server/http";
import { ApiError } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";
import { computePnL } from "@/server/services/pnl";

export const dynamic = "force-dynamic";

// GET /api/v1/owner/pnl?from=YYYY-MM-DD&to=YYYY-MM-DD — Munafa Nuqsan
// report (server compute; rules services/pnl.ts mein documented hain).
export const GET = handler(async (req) => {
  requireOwner(await getStaff(req));
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!from || !to) throw new ApiError(400, "BAD_RANGE", "from aur to dates zaroori hain");
  return ok({ report: await computePnL(from, to) });
});
