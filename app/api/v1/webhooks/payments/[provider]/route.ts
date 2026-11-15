import { handler } from "@/server/http";
import { ApiError } from "@/server/db";

export const dynamic = "force-dynamic";

// POST /api/v1/webhooks/payments/:provider — dynamic-gateway callbacks ONLY
// (plan §4.3H). No gateway is configured for a static-QR account, so no
// webhook is honoured in the foundation build: signature verification and
// idempotent provider-event handling land with the gateway onboarding step.
export const POST = handler(async () => {
  throw new ApiError(501, "NOT_CONFIGURED", "Payment gateway webhooks abhi configure nahi hain");
});
