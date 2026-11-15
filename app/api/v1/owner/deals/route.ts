import { handler, ok, body } from "@/server/http";
import { getStaff, requireOwner } from "@/server/auth";
import { fetchDealDTOs } from "@/server/dto";
import { createDeal, type DealInput } from "@/server/services/deals";

export const dynamic = "force-dynamic";

// GET /api/v1/owner/deals — saari deals (active + inactive), owner only.
export const GET = handler(async (req) => {
  requireOwner(await getStaff(req));
  return ok({ deals: await fetchDealDTOs() });
});

// POST /api/v1/owner/deals — nayi deal banayein.
export const POST = handler(async (req) => {
  const staff = requireOwner(await getStaff(req));
  const input = await body<DealInput>(req);
  return ok({ deal: await createDeal(input, staff) }, 201);
});
