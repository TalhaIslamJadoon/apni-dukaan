// Transactional event_outbox writer + audit helper (plan §3.11, §4.4).
// emit() MUST be called inside the business transaction so a committed
// change always has its event and a rolled-back change never emits one.
// A pg NOTIFY after commit wakes SSE relays immediately; the outbox row is
// the durable, replayable record (Last-Event-ID).
import type { PoolClient } from "pg";

export type EventType =
  | "order.created" | "order.status_changed" | "order.payment_changed"
  | "catalog.changed" | "stock.changed" | "dashboard.changed"
  | "table_session.changed" | "print_job.changed" | "settings.changed" | "staff.changed";

export async function emit(
  c: PoolClient,
  eventType: EventType,
  aggregateType: string,
  aggregateId: string | null,
  opts: { shopId?: string | null; audience?: string; payload?: Record<string, unknown> } = {}
): Promise<void> {
  const rows = await c.query(
    `INSERT INTO event_outbox (event_type, aggregate_type, aggregate_id, shop_id, audience_scope, payload)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [eventType, aggregateType, aggregateId, opts.shopId ?? null, opts.audience ?? "staff", JSON.stringify(opts.payload ?? {})]
  );
  const id = rows.rows[0].id as number;
  await c.query(`SELECT pg_notify('pos_events', $1)`, [String(id)]);
}

export async function audit(
  c: PoolClient,
  actor: { type: "staff" | "customer" | "system"; staffId?: string | null; customerId?: string | null },
  action: string,
  entityType: string,
  entityId: string | null,
  after?: Record<string, unknown> | null,
  before?: Record<string, unknown> | null
): Promise<void> {
  await c.query(
    `INSERT INTO audit_log (actor_type, actor_staff_id, actor_customer_id, action, entity_type, entity_id, before_data, after_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [actor.type, actor.staffId ?? null, actor.customerId ?? null, action, entityType, entityId,
     before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]
  );
}
