import { handler, ok } from "@/server/http";
import { fetchMenuDTOs, fetchGroceryDTOs, fetchDealDTOs } from "@/server/dto";
import { getStaff } from "@/server/auth";

export const dynamic = "force-dynamic";

// GET /api/v1/catalog — staff get the full catalogue (real wholesale prices,
// real stock, menu lagat/cost, saari deals). Everyone else gets the
// public-safe shape: retail prices only, availability (1/0) instead of
// exact stock counts, no cost, sirf ACTIVE deals (plan §4.3F).
export const GET = handler(async (req) => {
  const staff = await getStaff(req);
  const menu = await fetchMenuDTOs(!!staff);
  const grocery = await fetchGroceryDTOs(!!staff);
  const deals = await fetchDealDTOs(!staff);
  if (!staff) {
    for (const m of menu as any[]) m.stock = m.stock > 0 ? 1 : 0;
    for (const g of grocery.items as any[]) g.stock = g.stock > 0 ? 1 : 0;
  }
  return ok({ menu, heads: grocery.heads, subs: grocery.subs, items: grocery.items, deals });
});
