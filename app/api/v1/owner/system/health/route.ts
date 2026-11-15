import { handler, ok } from "@/server/http";
import { q, one } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";

export const dynamic = "force-dynamic";

// GET /api/v1/owner/system/health — DB connectivity, last backup, print
// agents/printers, failed jobs (plan §1.8).
export const GET = handler(async (req) => {
  requireOwner(await getStaff(req));
  let dbOk = true;
  try { await q("SELECT 1"); } catch { dbOk = false; }
  const lastBackup = await one<any>("SELECT * FROM backup_runs ORDER BY started_at DESC LIMIT 1").catch(() => null);
  const failedJobs = await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM print_jobs WHERE status = 'failed'").catch(() => ({ n: 0 }));
  const queuedJobs = await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM print_jobs WHERE status = 'queued'").catch(() => ({ n: 0 }));
  const printers = await q<any>("SELECT id, role, display_name, connection_type, address, is_active FROM printers ORDER BY role").catch(() => []);
  const agents = await q<any>("SELECT id, display_name, last_seen_at, is_active FROM print_agents ORDER BY display_name").catch(() => []);
  return ok({
    health: {
      database: dbOk ? "ok" : "down",
      appVersion: "phase2-foundation",
      serverTime: new Date().toISOString(),
      lastBackup: lastBackup ? {
        status: lastBackup.status, fileName: lastBackup.file_name,
        startedAt: new Date(lastBackup.started_at).toISOString(),
        sha256: lastBackup.sha256, error: lastBackup.error,
      } : null,
      failedPrintJobs: failedJobs?.n ?? 0,
      queuedPrintJobs: queuedJobs?.n ?? 0,
      printers, agents,
    },
  });
});
