import { handler, ok } from "@/server/http";
import { q } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";

export const dynamic = "force-dynamic";

// GET /api/v1/owner/print-jobs?status=queued|failed|... — the durable print
// queue (plan §1.5). Jobs wait for the print agent (deployment step).
export const GET = handler(async (req) => {
  requireOwner(await getStaff(req));
  const status = new URL(req.url).searchParams.get("status");
  const rows = await q<any>(
    `SELECT * FROM print_jobs WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT 200`,
    [status]
  );
  return ok({
    jobs: rows.map((j) => ({
      id: j.id, type: j.job_type, status: j.status, isReprint: j.is_reprint,
      billId: j.bill_id, orderId: j.order_id, printerId: j.printer_id,
      attempts: j.attempt_count, lastError: j.last_error,
      createdAt: new Date(j.created_at).toISOString(),
    })),
  });
});
