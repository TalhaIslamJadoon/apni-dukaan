import { handler, ok } from "@/server/http";
import { ApiError } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";
import { sessionDTO } from "@/server/services/owner";

export const dynamic = "force-dynamic";

export const GET = handler(async (req, ctx: { params: Promise<{ sessionId: string }> }) => {
  requireOwner(await getStaff(req));
  const { sessionId } = await ctx.params;
  const s = await sessionDTO(sessionId);
  if (!s) throw new ApiError(404, "SESSION_NOT_FOUND", "Session nahi mila");
  return ok({ session: s });
});
