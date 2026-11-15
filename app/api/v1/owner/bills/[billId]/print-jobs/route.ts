import { handler, ok, body } from "@/server/http";
import { tx, one, ApiError } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";
import { fetchOrderDTOById } from "@/server/dto";

export const dynamic = "force-dynamic";

// POST /api/v1/owner/bills/:billId/print-jobs { jobType?, reprint? }
// Queues a durable print job with an immutable payload snapshot (plan §1.5).
// The print AGENT that drives real hardware is a deployment step; jobs wait
// in 'queued' until an agent claims them. Browser print remains the fallback.
export const POST = handler(async (req, ctx: { params: Promise<{ billId: string }> }) => {
  const staff = requireOwner(await getStaff(req));
  const { billId } = await ctx.params;
  const b = await one<any>("SELECT * FROM bills WHERE id::text = $1 OR bill_no = $1", [billId]);
  if (!b) throw new ApiError(404, "BILL_NOT_FOUND", "Bill nahi mila");
  const input = await body<{ jobType?: string; reprint?: boolean }>(req).catch(() => ({} as { jobType?: string; reprint?: boolean }));
  const jobType = input.jobType ?? "receipt";
  const links = await (await import("@/server/db")).q<any>("SELECT order_id FROM bill_orders WHERE bill_id = $1", [b.id]);
  const orders: unknown[] = [];
  for (const l of links) orders.push(await fetchOrderDTOById(l.order_id));
  const printer = await one<any>("SELECT id FROM printers WHERE role = $1 AND is_active = true LIMIT 1", [jobType === "barcode_label" ? "label" : jobType === "kitchen_ticket" ? "kitchen" : "receipt"]);
  const job = await tx(async (c) => {
    const ins = await c.query(
      `INSERT INTO print_jobs (idempotency_key, printer_id, job_type, bill_id, payload, is_reprint, requested_by_staff_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, status`,
      [`${jobType}:${b.id}:${Date.now()}`, printer?.id ?? null, jobType, b.id,
       JSON.stringify({ billNo: b.bill_no, orders }), !!input.reprint, staff.id]
    );
    return ins.rows[0];
  });
  return ok({ job: { id: job.id, status: job.status, printerAssigned: !!printer } }, 201);
});
