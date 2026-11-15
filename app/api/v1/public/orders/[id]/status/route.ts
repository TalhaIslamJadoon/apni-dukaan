import { handler, ok } from "@/server/http";
import { one, ApiError } from "@/server/db";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

// GET /api/v1/public/orders/:id/status — a table guest reads ONLY their own
// order's status with the unguessable access token issued at placement
// (header: x-order-access-token). No other order data is exposed.
export const GET = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const token = req.headers.get("x-order-access-token");
  if (!token) throw new ApiError(401, "TOKEN_REQUIRED", "Order access token zaroori hai");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const o = await one<any>("SELECT id, status, token_no, payment_status, reject_reason FROM orders WHERE id = $1 AND access_token_hash = $2", [id, hash]);
  if (!o) throw new ApiError(404, "ORDER_NOT_FOUND", "Order nahi mila");
  return ok({
    order: {
      id: o.id,
      status: o.status === "received" ? "pending" : o.status,
      token: o.token_no ?? 0,
      ...(o.payment_status ? { paymentStatus: o.payment_status } : {}),
      ...(o.reject_reason ? { rejectReason: o.reject_reason } : {}),
    },
  });
});
