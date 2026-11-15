import { handler, ok, body } from "@/server/http";
import { getStaff, requireOwner } from "@/server/auth";
import { upsertSubHead } from "@/server/services/catalogAdmin";

export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  requireOwner(await getStaff(req));
  const input = await body<any>(req);
  return ok(await upsertSubHead(input), 201);
});
