import { handler, ok, body } from "@/server/http";
import { getStaff, requireOwner } from "@/server/auth";
import { updateDeal, deleteDeal, type DealInput } from "@/server/services/deals";

export const dynamic = "force-dynamic";

// PATCH /api/v1/owner/deals/:id — deal edit (naam, price, items, active).
export const PATCH = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const staff = requireOwner(await getStaff(req));
  const { id } = await ctx.params;
  const input = await body<DealInput>(req);
  return ok({ deal: await updateDeal(id, input, staff) });
});

// DELETE /api/v1/owner/deals/:id — deal delete (past orders keep their
// frozen component snapshots; history kabhi nahi tutti).
export const DELETE = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const staff = requireOwner(await getStaff(req));
  const { id } = await ctx.params;
  await deleteDeal(id, staff);
  return ok({ deleted: true });
});
