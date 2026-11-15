// Document numbering inside the caller's transaction (plan §3.9): a locked
// counter row means concurrent checkouts can never take the same number.
import type { PoolClient } from "pg";

export async function nextCounterValue(c: PoolClient, key: string): Promise<number> {
  const r = await c.query(
    `INSERT INTO document_counters (counter_key, next_value) VALUES ($1, 2)
     ON CONFLICT (counter_key) DO UPDATE SET next_value = document_counters.next_value + 1, updated_at = now()
     RETURNING next_value - 1 AS v`,
    [key]
  );
  return r.rows[0].v as number;
}

export async function nextCounterBill(c: PoolClient): Promise<string> {
  const v = await nextCounterValue(c, "bill");
  return `B-${String(v).padStart(4, "0")}`;
}
