import { handler, ok } from "@/server/http";
import { ApiError } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";
import { fetchOrderDTOById } from "@/server/dto";

export const dynamic = "force-dynamic";

// GET /api/v1/owner/orders/:orderId
export const GET = handler(async (req, ctx: { params: Promise<{ orderId: string }> }) => {
  requireOwner(await getStaff(req));
  const { orderId } = await ctx.params;
  const order = await fetchOrderDTOById(orderId);
  if (!order) throw new ApiError(404, "ORDER_NOT_FOUND", "Order nahi mila");
  return ok({ order });
});
