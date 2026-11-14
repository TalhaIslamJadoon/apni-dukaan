import { listOrders, postOrder } from "@/server/handlers/ordersHandler";

export const dynamic = "force-dynamic";

export const GET = listOrders;
export const POST = postOrder;
