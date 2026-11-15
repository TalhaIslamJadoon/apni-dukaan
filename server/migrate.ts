// Applies server/schema.sql (idempotent). Run: npm run db:migrate
import fs from "node:fs";
import path from "node:path";
import { pool } from "./db";

async function main() {
  const sql = fs.readFileSync(path.join(process.cwd(), "server", "schema.sql"), "utf8");
  await pool().query(sql);
  console.log("[migrate] schema applied");
  await pool().end();
}

main().catch((e) => {
  console.error("[migrate] FAILED:", e);
  process.exit(1);
});
