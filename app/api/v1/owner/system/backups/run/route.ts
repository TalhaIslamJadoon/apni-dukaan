import { handler, ok } from "@/server/http";
import { q } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

const run = promisify(execFile);

// POST /api/v1/owner/system/backups/run — manual backup: pg_dump custom
// format into BACKUP_DIR (default ./backups), checksum + backup_runs row
// (plan §1.7). Scheduling/off-server copy are deployment steps.
export const POST = handler(async (req) => {
  requireOwner(await getStaff(req));
  const dir = process.env.BACKUP_DIR || path.join(process.cwd(), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `canteen-pos-${stamp}.dump`;
  const filePath = path.join(dir, fileName);
  const ins = await q<{ id: string }>(
    "INSERT INTO backup_runs (status, file_name, storage_location, database_from, app_version) VALUES ('running',$1,$2,'canteen_pos','phase2-foundation') RETURNING id",
    [fileName, dir]
  );
  const runId = ins[0].id;
  try {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error("DATABASE_URL not set");
    await run("pg_dump", ["-Fc", "-f", filePath, dbUrl], { timeout: 120000 });
    const data = fs.readFileSync(filePath);
    const sha = crypto.createHash("sha256").update(data).digest("hex");
    await q("UPDATE backup_runs SET status = 'succeeded', finished_at = now(), size_bytes = $2, sha256 = $3 WHERE id = $1", [runId, data.length, sha]);
    return ok({ backup: { id: runId, fileName, sizeBytes: data.length, sha256: sha, status: "succeeded" } });
  } catch (e) {
    await q("UPDATE backup_runs SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1", [runId, String(e).slice(0, 500)]);
    return ok({ backup: { id: runId, fileName, status: "failed", error: String(e).slice(0, 300) } });
  }
});
