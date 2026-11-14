import { handler, ok } from "@/server/http";
import { shopSettingsDTO } from "@/server/dto";
import { q, businessDate } from "@/server/db";
import { getStaff, getCustomer } from "@/server/auth";

export const dynamic = "force-dynamic";

// GET /api/v1/bootstrap — settings, shops, server time/business date, caller.
export const GET = handler(async (req) => {
  const [settings, shops, staff, customer] = await Promise.all([
    shopSettingsDTO(),
    q("SELECT kind, display_name FROM shops WHERE is_active = true"),
    getStaff(req),
    getCustomer(req),
  ]);
  return ok({
    settings,
    shops: shops.map((s: any) => ({ kind: s.kind, displayName: s.display_name })),
    serverTime: new Date().toISOString(),
    businessDate: businessDate(),
    appVersion: "phase2-foundation",
    staff: staff ? { id: staff.id, name: staff.name, tabs: staff.tabs, isOwner: staff.isOwner } : null,
    customer: customer ? { id: customer.id, name: customer.name, mobile: customer.mobile } : null,
  });
});
