import { handler, ok, body } from "@/server/http";
import { getStaff, requireOwner } from "@/server/auth";
import { upsertVariant } from "@/server/services/catalogAdmin";

export const dynamic = "force-dynamic";

// POST /api/v1/owner/grocery/products/:productId/variants { name }
// A variant is a flavour/type under the master (Black / Pink / Anti-Dandruff).
export const POST = handler(async (req, ctx: { params: Promise<{ productId: string }> }) => {
  requireOwner(await getStaff(req));
  const { productId } = await ctx.params;
  const b = await body<{ name: string }>(req);
  return ok(await upsertVariant({ productId, name: b.name }), 201);
});
