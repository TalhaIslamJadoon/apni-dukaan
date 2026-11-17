import { handler, ok } from "@/server/http";
import { fetchMenuDTOs, fetchGroceryDTOs, fetchDealDTOs, shopSettingsDTO } from "@/server/dto";
import { listRentalItems } from "@/server/services/rentals";
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
  // Rental items board/public-safe hain (sirf dress ki maloomat + booked
  // qty count; customer data kabhi nahi) — rentals ON ho to shamil karo
  // taake Dress Board baghair login ke chal sake.
  const settings = await shopSettingsDTO();
  const rentals = settings.rentalsEnabled ? await listRentalItems() : [];
  return ok({ menu, heads: grocery.heads, subs: grocery.subs, items: grocery.items, deals, rentals });
});
