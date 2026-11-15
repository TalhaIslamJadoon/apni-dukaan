import { handler, ok, body } from "@/server/http";
import { getStaff, requireOwner } from "@/server/auth";
import { upsertProduct, type ProductInput } from "@/server/services/catalogAdmin";

export const dynamic = "force-dynamic";

// POST /api/v1/owner/grocery/products — create a master product (brand +
// item; variants/packings are managed under it).
export const POST = handler(async (req) => {
  const staff = requireOwner(await getStaff(req));
  const input = await body<ProductInput>(req);
  return ok(await upsertProduct(input, staff), 201);
});
