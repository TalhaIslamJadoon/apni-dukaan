import { handler, ok, body } from "@/server/http";
import { ApiError } from "@/server/db";
import { getStaff, getCustomer, requireStaff, requireCustomer } from "@/server/auth";
import { confirmPayment, rejectPayment, reproofPayment } from "@/server/services/orders";

export const dynamic = "force-dynamic";

// POST /api/v1/orders/:id/payment { action: 'confirm' | 'reject' | 'reproof', reason?, proof? }
// confirm/reject: staff (owner or the shop's counter tab). reproof: the
// order's own customer after a rejection.
export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const b = await body<{ action: string; reason?: string; proof?: { method: string; txnId?: string; amount: number; proofImage: string } }>(req);
  if (b.action === "confirm") {
    const staff = requireStaff(await getStaff(req));
    return ok({ order: await confirmPayment(id, staff) });
  }
  if (b.action === "reject") {
    const staff = requireStaff(await getStaff(req));
    return ok({ order: await rejectPayment(id, b.reason?.trim() || "Payment proof qabool nahi — sahi payment karke dobara proof upload karein", staff) });
  }
  if (b.action === "reproof") {
    const customer = requireCustomer(await getCustomer(req));
    if (!b.proof) throw new ApiError(400, "PROOF_REQUIRED", "Naya proof zaroori hai");
    return ok({ order: await reproofPayment(id, b.proof, customer) });
  }
  throw new ApiError(400, "BAD_ACTION", "Action ghalat hai");
});
