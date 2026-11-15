import { handler, ok } from "@/server/http";
import { shopSettingsDTO, fetchMenuDTOs, fetchGroceryDTOs, fetchDealDTOs } from "@/server/dto";

export const dynamic = "force-dynamic";

// GET /api/v1/public/bootstrap — customer-facing shop + catalogue data.
// Retail prices and availability ONLY: no wholesale price, no exact stock
// counts, no menu cost, no staff/Udhaar data (plan §4.3F). Deals: sirf
// ACTIVE wali (customers ko band deals nahi dikhti). Settings mein
// business shape (hasCanteen / retailType / setupDone) shamil hai taake
// /online aur boards apna view gate kar saken.
export const GET = handler(async () => {
  const settings = await shopSettingsDTO();
  const menu = (await fetchMenuDTOs(false)) as any[];
  const grocery = await fetchGroceryDTOs(false);
  const deals = await fetchDealDTOs(true);
  for (const m of menu) m.stock = m.stock > 0 ? 1 : 0;
  for (const g of grocery.items as any[]) g.stock = g.stock > 0 ? 1 : 0;
  return ok({ settings, menu, heads: grocery.heads, subs: grocery.subs, items: grocery.items, deals });
});
