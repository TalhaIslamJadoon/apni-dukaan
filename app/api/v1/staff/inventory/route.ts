import { handler, ok } from "@/server/http";
import { getStaff, requireStaff } from "@/server/auth";
import { fetchMenuDTOs, fetchGroceryDTOs } from "@/server/dto";

export const dynamic = "force-dynamic";

// GET /api/v1/staff/inventory — both inventories with balances + thresholds
// (plan §4.3D). Requires the stock tab (owner included via their grants).
export const GET = handler(async (req) => {
  requireStaff(await getStaff(req), "stock");
  const menu = await fetchMenuDTOs();
  const grocery = await fetchGroceryDTOs(true);
  return ok({ menu, heads: grocery.heads, subs: grocery.subs, items: grocery.items });
});
