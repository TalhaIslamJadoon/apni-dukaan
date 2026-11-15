import { handler, ok } from "@/server/http";
import { tx, ApiError } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";
import { emit } from "@/server/events";

export const dynamic = "force-dynamic";

// POST /api/v1/owner/print-jobs/:jobId/retry — requeue a failed job (the
// same job resumes; a deliberate extra copy is a separate reprint job).
export const POST = handler(async (req, ctx: { params: Promise<{ jobId: string }> }) => {
  requireOwner(await getStaff(req));
  const { jobId } = await ctx.params;
  await tx(async (c) => {
    const r = await c.query("UPDATE print_jobs SET status = 'queued', last_error = NULL WHERE id::text = $1 AND status IN ('failed','cancelled') RETURNING id", [jobId]);
    if (!r.rows[0]) throw new ApiError(409, "NOT_RETRYABLE", "Ye job retry nahi ho sakti");
    await emit(c, "print_job.changed", "print_job", jobId, { payload: { status: "queued" } });
  });
  return ok({ retried: true });
});
