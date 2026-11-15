import { handler, ok, body } from "@/server/http";
import { getStaff, requireOwner } from "@/server/auth";
import { upsertPacking } from "@/server/services/catalogAdmin";

export const dynamic = "force-dynamic";

// POST /api/v1/owner/grocery/variants/:variantId/packings
// A packing is a size of the variant (500g / 1kg) or a sealed-pack count
// (Snack Pack / Full Dabba with containsQty packs). Each carries its own
// barcode + prices, and optionally its own wholesale minimum / stock level.
export const POST = handler(async (req, ctx: { params: Promise<{ variantId: string }> }) => {
  requireOwner(await getStaff(req));
  const { variantId } = await ctx.params;
  const b = await body<any>(req);
  return ok(await upsertPacking({ ...b, variantId }), 201);
});
