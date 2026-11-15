import { handler, ok, body } from "@/server/http";
import { getStaff, requireOwner } from "@/server/auth";
import { updateExpense, deleteExpense, type ExpenseInput } from "@/server/services/pnl";

export const dynamic = "force-dynamic";

// PATCH /api/v1/owner/expenses/:id — kharcha edit.
export const PATCH = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const staff = requireOwner(await getStaff(req));
  const { id } = await ctx.params;
  const input = await body<ExpenseInput>(req);
  return ok({ expense: await updateExpense(id, input, staff) });
});

// DELETE /api/v1/owner/expenses/:id — kharcha delete.
export const DELETE = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const staff = requireOwner(await getStaff(req));
  const { id } = await ctx.params;
  await deleteExpense(id, staff);
  return ok({ deleted: true });
});
