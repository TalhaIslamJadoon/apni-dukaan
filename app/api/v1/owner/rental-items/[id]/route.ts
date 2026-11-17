import { handler, ok, body } from "@/server/http";
import { getStaff, requireOwner } from "@/server/auth";
import { updateRentalItem, deleteRentalItem, type RentalItemInput } from "@/server/services/rentals";

export const dynamic = "force-dynamic";

// PATCH /api/v1/owner/rental-items/:id — dress edit (sirf owner).
export const PATCH = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const staff = requireOwner(await getStaff(req));
  const { id } = await ctx.params;
  const input = await body<RentalItemInput>(req);
  return ok({ item: await updateRentalItem(id, input, staff) });
});

// DELETE /api/v1/owner/rental-items/:id — dress delete (history ho to 409).
export const DELETE = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const staff = requireOwner(await getStaff(req));
  const { id } = await ctx.params;
  await deleteRentalItem(id, staff);
  return ok({ deleted: true });
});
