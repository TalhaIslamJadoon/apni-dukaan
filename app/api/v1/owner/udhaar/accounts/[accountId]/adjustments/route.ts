import { handler, ok, body } from "@/server/http";
import { getStaff, requireOwner } from "@/server/auth";
import { udhaarAdjustment } from "@/server/services/owner";

export const dynamic = "force-dynamic";

// POST { amount (Rs, signed), note } — owner adjustment; note is required.
export const POST = handler(async (req, ctx: { params: Promise<{ accountId: string }> }) => {
  const staff = requireOwner(await getStaff(req));
  const { accountId } = await ctx.params;
  const b = await body<{ amount: number; note: string }>(req);
  return ok(await udhaarAdjustment(accountId, b.amount, b.note, staff));
});
