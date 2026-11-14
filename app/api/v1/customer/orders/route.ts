import { listOrders, postOrder } from "@/server/handlers/ordersHandler";

export const dynamic = "force-dynamic";

// Remote customer orders (plan §4.3F): same transactional handler; the
// dispatcher scopes by the customer session.
export const GET = listOrders;
export const POST = postOrder;
