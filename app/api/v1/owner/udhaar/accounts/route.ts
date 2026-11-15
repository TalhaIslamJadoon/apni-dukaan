import { handler, ok } from "@/server/http";
import { getStaff, requireOwner } from "@/server/auth";
import { udhaarAccounts } from "@/server/services/owner";

export const dynamic = "force-dynamic";

// GET /api/v1/owner/udhaar/accounts — khata list with derived balances.
export const GET = handler(async (req) => {
  requireOwner(await getStaff(req));
  return ok({ accounts: await udhaarAccounts() });
});
