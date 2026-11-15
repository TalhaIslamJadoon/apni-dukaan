import { confirmPaymentHandler } from "@/server/handlers/paymentConfirm";

export const dynamic = "force-dynamic";

// POST /api/v1/payments/:paymentId/confirm (staff) — plan §4.3A.
export const POST = confirmPaymentHandler;
