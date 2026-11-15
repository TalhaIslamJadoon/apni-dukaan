import { handler, ok, body } from "@/server/http";
import { q, ApiError } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";
import { listTables, newTableToken } from "@/server/services/owner";
import { shopIdByKind } from "@/server/dto";

export const dynamic = "force-dynamic";

// GET /api/v1/owner/tables — dining tables + open-session state.
export const GET = handler(async (req) => {
  requireOwner(await getStaff(req));
  return ok({ tables: await listTables() });
});

// POST /api/v1/owner/tables { tableNo } — add a table; the raw QR token is
// returned ONCE here (only its hash is stored) for printing the card.
export const POST = handler(async (req) => {
  requireOwner(await getStaff(req));
  const b = await body<{ tableNo: number }>(req);
  if (!b.tableNo || b.tableNo < 1) throw new ApiError(400, "BAD_TABLE_NO", "Table number ghalat hai");
  const shopId = await shopIdByKind("canteen");
  const t = newTableToken();
  await q(
    "INSERT INTO dining_tables (shop_id, table_no, label, public_token_hash) VALUES ($1,$2,$3,$4)",
    [shopId, b.tableNo, `Table ${b.tableNo}`, t.hash]
  );
  return ok({ table: { tableNo: b.tableNo, label: `Table ${b.tableNo}` }, qrToken: t.raw }, 201);
});
