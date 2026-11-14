import { handler, ok } from "@/server/http";
import { tx, one, ApiError } from "@/server/db";
import { getPrintAgent, requirePrintAgent } from "@/server/auth";
import { emit } from "@/server/events";

export const dynamic = "force-dynamic";

// POST /api/v1/agent/jobs/:jobId/complete — the agent sent the job's bytes to
// the printer successfully: sent → printed (plan §1.5). Only the claiming
// agent may complete its own claimed job. Note: this confirms the bytes were
// handed to the printer — paper-out/jam cannot be detected on raw channels.
export const POST = handler(async (req, ctx: { params: Promise<{ jobId: string }> }) => {
  const agent = requirePrintAgent(await getPrintAgent(req));
  const { jobId } = await ctx.params;
  const done = await tx(async (c) => {
    const r = await c.query(
      `UPDATE print_jobs SET status = 'printed', printed_at = now()
       WHERE id::text = $1 AND status = 'sent' AND claimed_by_agent_id = $2 RETURNING id`,
      [jobId, agent.id]
    );
    if (!r.rows[0]) return false;
    await emit(c, "print_job.changed", "print_job", jobId, { payload: { status: "printed" } });
    return true;
  });
  if (!done) {
    const exists = await one<any>("SELECT id, status FROM print_jobs WHERE id::text = $1", [jobId]);
    if (!exists) throw new ApiError(404, "JOB_NOT_FOUND", "Print job nahi mila");
    throw new ApiError(409, "JOB_NOT_CLAIMED", "Ye job is agent ke claim mein nahi hai ya pehle se complete hai");
  }
  return ok({ printed: true });
});
