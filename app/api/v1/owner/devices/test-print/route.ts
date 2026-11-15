import { handler, ok, body } from "@/server/http";
import { getStaff, requireOwner } from "@/server/auth";
import { createTestPrintJob, type PrinterRole } from "@/server/services/devices";

export const dynamic = "force-dynamic";

// POST /api/v1/owner/devices/test-print { role: 'receipt'|'kitchen'|'label' }
// Us role ke printer par ek chhoti test print bhejta hai — owner ko kagaz
// par saboot mil jata hai ke printer chal raha hai.
export const POST = handler(async (req) => {
  const staff = requireOwner(await getStaff(req));
  const b = await body<{ role?: PrinterRole }>(req);
  const out = await createTestPrintJob(b.role as PrinterRole, staff.id);
  return ok(out, 201);
});
