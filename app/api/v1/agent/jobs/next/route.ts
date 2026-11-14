import { handler, ok } from "@/server/http";
import { tx } from "@/server/db";
import { getPrintAgent, requirePrintAgent } from "@/server/auth";
import { emit } from "@/server/events";

export const dynamic = "force-dynamic";

// POST /api/v1/agent/jobs/next — atomically claim the oldest printable job
// (plan §1.5: queued → sent). Claimable jobs: queued jobs whose printer is
// assigned to THIS agent, plus unassigned jobs (printer_id IS NULL — the
// agent routes those by job type from its local config). A job this agent
// claimed but never finished (agent crash) becomes claimable again by the
// same agent after 10 minutes — delivery is at-least-once, so a crash after
// the physical print can produce one duplicate; the owner retry/reprint flow
// stays the deliberate-copy path. Returns { job: null } when nothing waits.
export const POST = handler(async (req) => {
  const agent = requirePrintAgent(await getPrintAgent(req));
  const job = await tx(async (c) => {
    const r = await c.query(
      `SELECT j.*, p.role AS printer_role, p.display_name AS printer_name,
              p.connection_type AS printer_connection, p.address AS printer_address,
              p.command_language AS printer_language, p.paper_width_mm,
              p.label_width_mm, p.label_height_mm
       FROM print_jobs j
       LEFT JOIN printers p ON p.id = j.printer_id
       WHERE (
         (j.status = 'queued'
           AND (j.printer_id IS NULL
                OR j.printer_id IN (SELECT id FROM printers WHERE agent_id = $1 AND is_active = true)))
         OR (j.status = 'sent' AND j.claimed_by_agent_id = $1
             AND j.sent_at < now() - interval '10 minutes')
       )
       ORDER BY j.created_at ASC
       LIMIT 1
       FOR UPDATE OF j SKIP LOCKED`,
      [agent.id]
    );
    const row = r.rows[0];
    if (!row) return null;
    await c.query(
      `UPDATE print_jobs SET status = 'sent', sent_at = now(),
         attempt_count = attempt_count + 1, claimed_by_agent_id = $2, last_error = NULL
       WHERE id = $1`,
      [row.id, agent.id]
    );
    await emit(c, "print_job.changed", "print_job", row.id, { payload: { status: "sent" } });
    return row;
  });
  if (!job) return ok({ job: null });
  return ok({
    job: {
      id: job.id,
      type: job.job_type,
      status: "sent",
      isReprint: job.is_reprint,
      billId: job.bill_id,
      orderId: job.order_id,
      printerId: job.printer_id,
      attempts: job.attempt_count + 1,
      payload: job.payload,
      printer: job.printer_id ? {
        role: job.printer_role, displayName: job.printer_name,
        connectionType: job.printer_connection, address: job.printer_address,
        commandLanguage: job.printer_language,
        paperWidthMm: job.paper_width_mm,
        labelWidthMm: job.label_width_mm, labelHeightMm: job.label_height_mm,
      } : null,
    },
  });
});
