import { handler, ok, body } from "@/server/http";
import { getStaff, requireOwner } from "@/server/auth";
import { listRentalItems, createRentalItem, type RentalItemInput } from "@/server/services/rentals";

export const dynamic = "force-dynamic";

// GET /api/v1/owner/rental-items — saari dresses (owner).
export const GET = handler(async (req) => {
  requireOwner(await getStaff(req));
  return ok({ items: await listRentalItems() });
});

// POST /api/v1/owner/rental-items — nayi dress (sirf owner).
export const POST = handler(async (req) => {
  const staff = requireOwner(await getStaff(req));
  const input = await body<RentalItemInput>(req);
  return ok({ item: await createRentalItem(input, staff) }, 201);
});
