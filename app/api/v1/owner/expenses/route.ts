import { handler, ok, body } from "@/server/http";
import { getStaff, requireOwner } from "@/server/auth";
import { listExpenses, createExpense, type ExpenseInput } from "@/server/services/pnl";

export const dynamic = "force-dynamic";

// GET /api/v1/owner/expenses — kharchon ka register (owner only).
export const GET = handler(async (req) => {
  requireOwner(await getStaff(req));
  return ok({ expenses: await listExpenses() });
});

// POST /api/v1/owner/expenses — naya kharcha darj karein.
export const POST = handler(async (req) => {
  const staff = requireOwner(await getStaff(req));
  const input = await body<ExpenseInput>(req);
  return ok({ expense: await createExpense(input, staff) }, 201);
});
