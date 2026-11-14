import { handler, ok, body } from "@/server/http";
import { ApiError, businessDate } from "@/server/db";
import { getStaff, getCustomer } from "@/server/auth";
import { fetchMenuDTOs, fetchGroceryDTOs, fetchOrdersDTO } from "@/server/dto";
import { listStockEntries } from "@/server/services/inventory";
import { answerQuery, type Audience, type Snap } from "@/lib/assistant";

export const dynamic = "force-dynamic";

// POST /api/v1/assistant/query { query }
// The audience is determined from the SESSION on the server — never from a
// client-supplied field (plan §4.3G). The snapshot handed to the Phase 1
// answer engine is permission-scoped per audience: customers see only their
// own orders and never wholesale prices; non-owner staff never receive
// Udhaar/stock-entry data.
export const POST = handler(async (req) => {
  const staff = await getStaff(req);
  const customer = await getCustomer(req);
  if (!staff && !customer) throw new ApiError(401, "NOT_LOGGED_IN", "Login zaroori hai");
  const b = await body<{ query: string }>(req);
  if (!b.query?.trim()) throw new ApiError(400, "EMPTY_QUERY", "Sawal likhein");

  let audience: Audience;
  if (customer && !staff) audience = "customer";
  else if (staff!.isOwner || staff!.tabs.includes("owner")) audience = "owner";
  else if (staff!.tabs.length === 1 && staff!.tabs[0] === "stock") audience = "stock";
  else if (staff!.tabs.length === 1 && staff!.tabs[0] === "kitchen") audience = "kitchen";
  else audience = "staff";

  const isOwner = audience === "owner";
  const groceryDTOs = await fetchGroceryDTOs(isOwner);
  const menu = await fetchMenuDTOs();
  let orders: unknown[] = [];
  if (customer && !staff) orders = await fetchOrdersDTO({ customerId: customer.id, limit: 50 });
  else orders = await fetchOrdersDTO({ businessDate: businessDate(), limit: 300 });
  const entries = isOwner || audience === "stock" ? await listStockEntries(undefined, 50) : [];

  const snap = {
    grocery: groceryDTOs.items, heads: groceryDTOs.heads, subs: groceryDTOs.subs,
    menu, orders, entries,
  } as unknown as Snap;

  const answer = answerQuery(b.query, {
    audience,
    memberName: staff?.name ?? customer?.name,
    staffTabs: staff?.tabs,
    customerMobile: customer?.mobile,
    customerName: customer?.name,
  }, snap);
  return ok({ answer, audience });
});
