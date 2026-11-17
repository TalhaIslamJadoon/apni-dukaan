import { handler, ok, body } from "@/server/http";
import { getStaff, requireStaff } from "@/server/auth";
import { createRentalBooking, type RentalBookingInput } from "@/server/services/rentals";

export const dynamic = "force-dynamic";

// POST /api/v1/staff/rentals/bookings — nayi booking (dress booked ho jati hai).
export const POST = handler(async (req) => {
  const staff = requireStaff(await getStaff(req), "rentals");
  const input = await body<RentalBookingInput>(req);
  return ok({ booking: await createRentalBooking(input, staff) }, 201);
});
