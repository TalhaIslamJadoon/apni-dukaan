import { handler, ok, body } from "@/server/http";
import { getStaff, requireStaff } from "@/server/auth";
import { updateRentalBooking, deleteRentalBooking, type RentalBookingInput } from "@/server/services/rentals";

export const dynamic = "force-dynamic";

// PATCH /api/v1/staff/rentals/bookings/:id — pickup / wapsi / cancel
// (dress ki status usi transaction mein sync hoti hai).
export const PATCH = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const staff = requireStaff(await getStaff(req), "rentals");
  const { id } = await ctx.params;
  const input = await body<RentalBookingInput>(req);
  return ok({ booking: await updateRentalBooking(id, input, staff) });
});

// DELETE /api/v1/staff/rentals/bookings/:id — booking delete (dress free).
export const DELETE = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const staff = requireStaff(await getStaff(req), "rentals");
  const { id } = await ctx.params;
  await deleteRentalBooking(id, staff);
  return ok({ deleted: true });
});
