import { handler, ok } from "@/server/http";
import { getStaff, requireOwner } from "@/server/auth";
import { udhaarLedger } from "@/server/services/owner";

export const dynamic = "force-dynamic";

export const GET = handler(async (req, ctx: { params: Promise<{ accountId: string }> }) => {
  requireOwner(await getStaff(req));
  const { accountId } = await ctx.params;
  return ok({ entries: await udhaarLedger(accountId) });
});
