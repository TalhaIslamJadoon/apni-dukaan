import { handler, ok, body } from "@/server/http";
import { one, ApiError } from "@/server/db";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

// POST /api/v1/public/table-sessions/resolve { token, tableNo? }
// Resolves a printed table-QR token to its table (plan §1.6/§4.3F). The raw
// token stays with the customer as the ordering capability; only its hash
// is stored.
export const POST = handler(async (req) => {
  const b = await body<{ token: string; tableNo?: number }>(req);
  if (!b.token) throw new ApiError(400, "TOKEN_REQUIRED", "Table token zaroori hai");
  const hash = crypto.createHash("sha256").update(b.token).digest("hex");
  const t = await one<any>(
    `SELECT t.*, s.kind AS shop_kind FROM dining_tables t JOIN shops s ON s.id = t.shop_id
     WHERE t.public_token_hash = $1 AND t.is_active = true`,
    [hash]
  );
  if (!t) throw new ApiError(404, "TABLE_NOT_FOUND", "Table QR ghalat ya purana hai — staff se nayi card lein");
  if (b.tableNo && Number(b.tableNo) !== t.table_no) throw new ApiError(400, "TABLE_MISMATCH", "Table number QR se match nahi karta");
  const session = await one<any>("SELECT id, status FROM table_sessions WHERE table_id = $1 AND status = 'open'", [t.id]);
  return ok({
    table: { tableNo: t.table_no, label: t.label, shopKind: t.shop_kind },
    openSessionId: session?.id ?? null,
    capability: b.token,
  });
});
