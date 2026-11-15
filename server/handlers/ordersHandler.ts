// Shared order endpoint logic (used by /orders, /customer/orders).
import { handler, ok, body } from "@/server/http";
import { ApiError, businessDate } from "@/server/db";
import { getStaff, getCustomer } from "@/server/auth";
import { fetchOrdersDTO, fetchOrderDTOById } from "@/server/dto";
import { createOrder, type Actor, type CreateOrderInput } from "@/server/services/orders";

export const listOrders = handler(async (req) => {
  const url = new URL(req.url);
  const staff = await getStaff(req);
  const customer = await getCustomer(req);
  const date = url.searchParams.get("date") ?? businessDate();
  if (customer && !staff) {
    const orders = await fetchOrdersDTO({ customerId: customer.id, limit: 200 });
    return ok({ orders });
  }
  if (!staff) throw new ApiError(401, "NOT_LOGGED_IN", "Login zaroori hai");
  const shop = url.searchParams.get("shop") as "canteen" | "grocery" | null;
  const orders = await fetchOrdersDTO({
    businessDate: date === "all" ? undefined : date,
    shopKind: shop ?? undefined,
    source: url.searchParams.get("source") ?? undefined,
    limit: 500,
  });
  return ok({ orders });
});

export const postOrder = handler(async (req) => {
  const input = await body<CreateOrderInput>(req);
  const staff = await getStaff(req);
  const customer = await getCustomer(req);
  let actor: Actor;
  if (staff) {
    actor = { type: "staff", staff };
    input.source = "counter";
  } else if (customer) {
    actor = { type: "customer", customer };
    input.source = "remote_online";
  } else {
    actor = { type: "public" };
    input.source = "table_qr";
    if (input.shopKind !== "canteen") throw new ApiError(403, "FORBIDDEN", "Table-QR ordering sirf canteen ke liye hai");
  }
  const result = await createOrder(input, actor);
  return ok({ order: result.order, ...(result.accessToken ? { accessToken: result.accessToken } : {}), ...(result.replay ? { replay: true } : {}) }, result.replay ? 200 : 201);
});

export const getOrder = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const staff = await getStaff(req);
  const customer = await getCustomer(req);
  if (!staff && !customer) throw new ApiError(401, "NOT_LOGGED_IN", "Login zaroori hai");
  const order = await fetchOrderDTOById(id);
  if (!order) throw new ApiError(404, "ORDER_NOT_FOUND", "Order nahi mila");
  if (!staff && customer) {
    // customer may only read their own orders
    const { one } = await import("@/server/db");
    const row = await one<any>("SELECT customer_id FROM orders WHERE id = $1", [id]);
    if (!row || row.customer_id !== customer.id) throw new ApiError(403, "FORBIDDEN", "Ye aap ka order nahi hai");
  }
  return ok({ order });
});
