import { handler, ok, body } from "@/server/http";
import { tx, one, ApiError } from "@/server/db";
import { getPrintAgent, requirePrintAgent } from "@/server/auth";
import { emit } from "@/server/events";

export const dynamic = "force-dynamic";

// POST /api/v1/agent/jobs/:jobId/fail { error } — rendering or sending failed:
// sent → failed with the error recorded in last_error (plan §1.5). The owner
// can requeue the same job from the print queue (retry route).
export const POST = handler(async (req, ctx: { params: Promise<{ jobId: string }> }) => {
  const agent = requirePrintAgent(await getPrintAgent(req));
  const { jobId } = await ctx.params;
  const b = await body<{ error?: string }>(req).catch(() => ({} as { error?: string }));
  const error = String(b.error || "unknown agent error").slice(0, 500);
  const done = await tx(async (c) => {
    const r = await c.query(
      `UPDATE print_jobs SET status = 'failed', last_error = $3
       WHERE id::text = $1 AND status = 'sent' AND claimed_by_agent_id = $2 RETURNING id`,
      [jobId, agent.id, error]
    );
    if (!r.rows[0]) return false;
    await emit(c, "print_job.changed", "print_job", jobId, { payload: { status: "failed", error } });
    return true;
  });
  if (!done) {
    const exists = await one<any>("SELECT id, status FROM print_jobs WHERE id::text = $1", [jobId]);
    if (!exists) throw new ApiError(404, "JOB_NOT_FOUND", "Print job nahi mila");
    throw new ApiError(409, "JOB_NOT_CLAIMED", "Ye job is agent ke claim mein nahi hai");
  }
  return ok({ failed: true });
});
