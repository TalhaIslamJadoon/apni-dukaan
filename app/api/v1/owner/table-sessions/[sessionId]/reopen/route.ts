import { handler, ok } from "@/server/http";
import { getStaff, requireOwner } from "@/server/auth";
import { reopenSession } from "@/server/services/owner";

export const dynamic = "force-dynamic";

// POST — reopen a settled session. Owner only, audited (plan §1.6).
export const POST = handler(async (req, ctx: { params: Promise<{ sessionId: string }> }) => {
  const staff = requireOwner(await getStaff(req));
  const { sessionId } = await ctx.params;
  return ok(await reopenSession(sessionId, staff));
});
