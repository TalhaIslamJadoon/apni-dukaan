import { handler, ok, body } from "@/server/http";
import { getStaff, requireStaff } from "@/server/auth";
import { settleSession, type SettlementPayment } from "@/server/services/owner";

export const dynamic = "force-dynamic";

// POST /api/v1/owner/table-sessions/:sessionId/settle
// { discount?: Rs, payments: [{ method: 'cash'|'jazzcash'|'easypaisa'|'raast'|'udhaar', amount: Rs, udhaarExternalId?, udhaarName? }] }
// One combined bill for the whole session; split payments supported. A
// settled session cannot be settled again.
export const POST = handler(async (req, ctx: { params: Promise<{ sessionId: string }> }) => {
  const staff = requireStaff(await getStaff(req));
  const { sessionId } = await ctx.params;
  const b = await body<{ discount?: number; payments: SettlementPayment[] }>(req);
  const result = await settleSession(sessionId, b.discount ?? 0, b.payments ?? [], staff);
  return ok({ settlement: result });
});
