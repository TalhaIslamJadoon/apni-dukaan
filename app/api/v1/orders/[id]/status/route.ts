import { handler, ok, body } from "@/server/http";
import { ApiError } from "@/server/db";
import { getStaff, requireStaff } from "@/server/auth";
import { updateOrderStatus } from "@/server/services/orders";

export const dynamic = "force-dynamic";

// PATCH /api/v1/orders/:id/status { status: 'preparing' | 'ready' | 'completed' | 'pending' | 'cancelled' }
export const PATCH = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const staff = requireStaff(await getStaff(req));
  const { id } = await ctx.params;
  const b = await body<{ status: string }>(req);
  if (!b.status) throw new ApiError(400, "MISSING_STATUS", "Status zaroori hai");
  const order = await updateOrderStatus(id, b.status, { type: "staff", staff });
  return ok({ order });
});
