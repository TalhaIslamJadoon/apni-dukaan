import { pool } from "@/server/db";
import { getStaff, getCustomer } from "@/server/auth";

export const dynamic = "force-dynamic";

// GET /api/v1/events — SSE backed by the transactional event_outbox
// (plan §4.4). Snapshot first (REST), then subscribe: the server replays
// everything after Last-Event-ID and streams new events as transactions
// commit (pg NOTIFY wakes the relay; a 2s poll is the safety net).
// Staff receive staff-audience events. Customers receive only events for
// their own orders.
export async function GET(req: Request) {
  const staff = await getStaff(req);
  const customer = await getCustomer(req);
  if (!staff && !customer) {
    return new Response(JSON.stringify({ error: { code: "NOT_LOGGED_IN", message: "Login zaroori hai" } }), {
      status: 401, headers: { "content-type": "application/json" },
    });
  }
  const url = new URL(req.url);
  let lastId = Number(req.headers.get("last-event-id") ?? url.searchParams.get("cursor") ?? 0) || 0;

  const encoder = new TextEncoder();
  let closed = false;
  let notifyResolve: (() => void) | null = null;

  const client = await pool().connect();
  await client.query("LISTEN pos_events");
  client.on("notification", () => { if (notifyResolve) { const r = notifyResolve; notifyResolve = null; r(); } });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: string) => { if (!closed) { try { controller.enqueue(encoder.encode(chunk)); } catch { closed = true; } } };
      send(`: connected\n\n`);
      const heartbeat = setInterval(() => send(`: hb ${Date.now()}\n\n`), 20000);
      req.signal.addEventListener("abort", () => { closed = true; clearInterval(heartbeat); });

      while (!closed) {
        try {
          const rows = await pool().query(
            "SELECT * FROM event_outbox WHERE id > $1 ORDER BY id ASC LIMIT 200",
            [lastId]
          );
          for (const ev of rows.rows) {
            lastId = Number(ev.id);
            if (customer && !staff) {
              // Customer scope: only events about their own orders.
              if (ev.aggregate_type !== "order" || !ev.aggregate_id) continue;
              const own = await pool().query("SELECT 1 FROM orders WHERE id = $1 AND customer_id = $2", [ev.aggregate_id, customer.id]);
              if (!own.rows[0]) continue;
            }
            send(`id: ${ev.id}\nevent: ${ev.event_type}\ndata: ${JSON.stringify({ id: Number(ev.id), type: ev.event_type, aggregateType: ev.aggregate_type, aggregateId: ev.aggregate_id, shopId: ev.shop_id, payload: ev.payload })}\n\n`);
          }
        } catch { /* transient DB error — keep the stream alive */ }
        if (closed) break;
        // Wait for the next NOTIFY or a 2s safety poll, whichever is first.
        await new Promise<void>((resolve) => {
          notifyResolve = resolve;
          setTimeout(() => { notifyResolve = null; resolve(); }, 2000);
        });
      }
      clearInterval(heartbeat);
      try { await client.query("UNLISTEN pos_events"); } catch { /* ignore */ }
      client.release();
      try { controller.close(); } catch { /* ignore */ }
    },
    cancel() { closed = true; },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
