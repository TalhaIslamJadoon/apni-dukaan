import { handler, ok } from "@/server/http";
import { getStaff, requireStaff } from "@/server/auth";
import { listRentalItems, listRentalBookings } from "@/server/services/rentals";

export const dynamic = "force-dynamic";

// GET /api/v1/staff/rentals — dresses + bookings (rentals tab wale staff).
export const GET = handler(async (req) => {
  requireStaff(await getStaff(req), "rentals");
  const [items, bookings] = await Promise.all([listRentalItems(), listRentalBookings()]);
  return ok({ items, bookings });
});
