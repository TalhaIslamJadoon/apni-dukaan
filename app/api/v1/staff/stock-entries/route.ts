import { handler, ok, body } from "@/server/http";
import { getStaff, requireStaff } from "@/server/auth";
import { createStockEntry, listStockEntries, type StockEntryInput } from "@/server/services/inventory";

export const dynamic = "force-dynamic";

// GET /api/v1/staff/stock-entries?shop=canteen|grocery — keeper entries log.
export const GET = handler(async (req) => {
  requireStaff(await getStaff(req), "stock");
  const shop = new URL(req.url).searchParams.get("shop") ?? undefined;
  return ok({ entries: await listStockEntries(shop) });
});

// POST /api/v1/staff/stock-entries — stock IN / wastage (one transaction:
// balance update + ledger entry with qty_after).
export const POST = handler(async (req) => {
  const staff = requireStaff(await getStaff(req), "stock");
  const input = await body<StockEntryInput>(req);
  const entry = await createStockEntry(input, staff);
  return ok({ entry }, 201);
});
