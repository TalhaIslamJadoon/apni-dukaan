import { handler, ok, body } from "@/server/http";
import { tx, ApiError } from "@/server/db";
import { shopSettingsDTO } from "@/server/dto";
import { emit, audit } from "@/server/events";
import { applyRetailTemplate } from "@/server/services/templates";

export const dynamic = "force-dynamic";

// POST /api/v1/setup/complete — PEHLA Business Setup (fresh install).
// Wizard login se pehle render hota hai (SetupGate), is liye ye endpoint
// baghair staff session ke chalta hai — LEKIN sirf jab tak
// system_settings.setup_done = false hai. Transaction ke andar dobara
// check hota hai; setup ho jane ke baad ye darwaza hamesha ke liye band
// (403 SETUP_ALREADY_DONE) — baad ki tabdeeli Owner Settings se owner
// session ke saath hi hogi. Template seed bhi yahin apply hota hai
// (guard: catalogue bilkul khali ho tab hi).
export const POST = handler(async (req) => {
  const b = await body<{
    hasCanteen?: boolean; retailType?: string | null; groceryName?: string;
  }>(req);
  let template: { applied: boolean; reason?: string } | undefined;
  await tx(async (c) => {
    const cur = await c.query<{ setup_done: boolean }>(
      "SELECT setup_done FROM system_settings WHERE id = true FOR UPDATE"
    );
    if (!cur.rows[0] || cur.rows[0].setup_done) {
      throw new ApiError(403, "SETUP_ALREADY_DONE", "Setup pehle ho chuka hai — tabdeeli Owner Dashboard → Settings se karein");
    }
    await c.query(
      `UPDATE system_settings SET
         has_canteen = $1,
         retail_type = $2,
         setup_done = true,
         updated_at = now() WHERE id = true`,
      [b.hasCanteen === true, b.retailType ?? null]
    );
    if (typeof b.retailType === "string" && b.retailType) {
      template = await applyRetailTemplate(c, b.retailType);
    }
    if (b.groceryName) {
      await c.query("UPDATE shops SET display_name = $1, updated_at = now() WHERE kind = 'grocery'", [b.groceryName]);
    }
    await emit(c, "settings.changed", "settings", null, {});
    if (template?.applied) await emit(c, "catalog.changed", "catalog", null, {});
    await audit(c, { type: "system" }, "setup.complete", "settings", null,
      { hasCanteen: b.hasCanteen === true, retailType: b.retailType ?? null });
  });
  return ok({ settings: await shopSettingsDTO(), ...(template ? { template } : {}) });
});
