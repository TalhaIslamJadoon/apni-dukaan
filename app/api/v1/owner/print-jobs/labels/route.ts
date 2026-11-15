import { handler, ok, body } from "@/server/http";
import { tx, q, ApiError, rupees } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";
import { emit } from "@/server/events";

export const dynamic = "force-dynamic";

// POST /api/v1/owner/print-jobs/labels { items: [{ productId, copies }] }
// Builds immutable 50×30mm label payloads (product name + retail price +
// Code128 value = barcode, else SKU) from CURRENT catalogue data and queues
// one label job per product (plan §4.3E). The browser sheet stays as the
// preview/fallback; the agent prints the native barcode command later.
export const POST = handler(async (req) => {
  const staff = requireOwner(await getStaff(req));
  const b = await body<{ items: { productId: string; copies: number }[] }>(req);
  if (!b.items?.length) throw new ApiError(400, "NO_ITEMS", "Label ke liye product chunein");
  const printer = (await q<any>("SELECT id FROM printers WHERE role = 'label' AND is_active = true LIMIT 1"))[0];
  const jobs: string[] = [];
  await tx(async (c) => {
    for (const it of b.items) {
      const p = (await c.query(
        "SELECT * FROM grocery_products WHERE (legacy_id = $1 OR id::text = $1) AND is_active = true", [it.productId]
      )).rows[0];
      if (!p) throw new ApiError(404, "PRODUCT_NOT_FOUND", `Product nahi mila: ${it.productId}`);
      const payload = {
        labels: Array.from({ length: Math.max(1, Math.min(200, it.copies || 1)) }, () => ({
          name: p.name,
          price: rupees(p.retail_price_paisa),
          code: p.barcode || p.sku,
          sku: p.sku,
          widthMm: 50, heightMm: 30,
        })),
      };
      const ins = await c.query(
        `INSERT INTO print_jobs (idempotency_key, printer_id, job_type, payload, requested_by_staff_id)
         VALUES ($1,$2,'barcode_label',$3,$4) RETURNING id`,
        [`label:${p.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, printer?.id ?? null, JSON.stringify(payload), staff.id]
      );
      jobs.push(ins.rows[0].id);
      await emit(c, "print_job.changed", "print_job", ins.rows[0].id, { payload: { status: "queued" } });
    }
  });
  return ok({ jobIds: jobs, printerAssigned: !!printer }, 201);
});
