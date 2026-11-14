import { handler } from "@/server/http";
import { ApiError } from "@/server/db";
import { getStaff, requireStaff } from "@/server/auth";

export const dynamic = "force-dynamic";

// POST /api/v1/bills/:billId/payment-intents — dynamic per-bill QR exists
// ONLY where a documented provider/gateway entitlement is configured
// (plan §1.4 Level B). None is configured in the foundation build, so this
// refuses cleanly instead of faking a payload; Level A (static official QR
// + staff confirmation) is the live behaviour.
export const POST = handler(async (req) => {
  requireStaff(await getStaff(req));
  throw new ApiError(501, "NOT_CONFIGURED", "Dynamic QR/gateway abhi configure nahi hai — static merchant QR + staff confirmation use karein");
});
