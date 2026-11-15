import { handler, ok, body } from "@/server/http";
import { getStaff, requireOwner } from "@/server/auth";
import { udhaarRepayment } from "@/server/services/owner";

export const dynamic = "force-dynamic";

// POST { amount (Rs), method, note? } — an Udhaar repayment, allocated FIFO.
export const POST = handler(async (req, ctx: { params: Promise<{ accountId: string }> }) => {
  const staff = requireOwner(await getStaff(req));
  const { accountId } = await ctx.params;
  const b = await body<{ amount: number; method?: string; note?: string }>(req);
  return ok(await udhaarRepayment(accountId, b.amount, (b.method ?? "cash").toLowerCase(), staff, b.note));
});
