import { handler, ok, body } from "@/server/http";
import { tx } from "@/server/db";
import { getStaff, requireOwner } from "@/server/auth";
import { shopSettingsDTO } from "@/server/dto";
import { emit, audit } from "@/server/events";
import { applyRetailTemplate } from "@/server/services/templates";

export const dynamic = "force-dynamic";

// GET/PATCH /api/v1/owner/settings — Shop Settings (names, payment numbers,
// wholesale minimum defaults). Owner only.
export const GET = handler(async (req) => {
  requireOwner(await getStaff(req));
  return ok({ settings: await shopSettingsDTO() });
});

export const PATCH = handler(async (req) => {
  const staff = requireOwner(await getStaff(req));
  const b = await body<{
    collegeName?: string; canteenName?: string; groceryName?: string;
    jazzcashNumber?: string; easypaisaNumber?: string; raastInfo?: string;
    wholesaleMinPieces?: number; wholesaleMinKg?: number;
    shopOpen?: boolean; closedContactNumber?: string;
    tableCount?: number;
    hasCanteen?: boolean; retailType?: string | null; setupDone?: boolean;
    boardColor?: string;
  }>(req);
  // Board rang sirf saaf #RRGGBB hex ho to hi save ho — warna purana rang.
  const boardColor = b.boardColor !== undefined && /^#[0-9a-f]{6}$/i.test(b.boardColor.trim())
    ? b.boardColor.trim() : null;
  // Tables are 1..100 — clamp whatever arrives to the sane range.
  const tableCount = b.tableCount === undefined
    ? null
    : Math.min(100, Math.max(1, Math.round(Number(b.tableCount) || 8)));
  let template: { applied: boolean; reason?: string } | undefined;
  await tx(async (c) => {
    await c.query(
      `UPDATE system_settings SET
         college_name = COALESCE($1, college_name),
         jazzcash_number = COALESCE($2, jazzcash_number),
         easypaisa_number = COALESCE($3, easypaisa_number),
         raast_info = COALESCE($4, raast_info),
         wholesale_min_pieces = COALESCE($5, wholesale_min_pieces),
         wholesale_min_kg = COALESCE($6, wholesale_min_kg),
         shop_open = COALESCE($7, shop_open),
         closed_contact_number = COALESCE($8, closed_contact_number),
         table_count = COALESCE($9, table_count),
         has_canteen = COALESCE($10, has_canteen),
         retail_type = CASE WHEN $11 THEN $12 ELSE retail_type END,
         setup_done = COALESCE($13, setup_done),
         board_color = COALESCE($14, board_color),
         updated_at = now() WHERE id = true`,
      [b.collegeName ?? null, b.jazzcashNumber ?? null, b.easypaisaNumber ?? null, b.raastInfo ?? null,
       b.wholesaleMinPieces ?? null, b.wholesaleMinKg ?? null,
       b.shopOpen === undefined ? null : b.shopOpen, b.closedContactNumber ?? null,
       tableCount,
       b.hasCanteen === undefined ? null : b.hasCanteen,
       b.retailType !== undefined, b.retailType ?? null,
       b.setupDone === undefined ? null : b.setupDone,
       boardColor]
    );
    // Business Setup confirm: a retail type was chosen → us template ka
    // seed try karein (guard andar hai: data save ho chuka ho to sirf
    // view badalta hai, catalogue ko haath nahi lagta).
    if (b.setupDone === true && typeof b.retailType === "string" && b.retailType) {
      template = await applyRetailTemplate(c, b.retailType);
    }
    // Keep dining_tables in sync with the count: activate/create 1..N for
    // the canteen, DEACTIVATE (never delete) tables above N — past orders
    // and bills keep their historical table rows untouched.
    if (tableCount !== null) {
      await c.query(
        `INSERT INTO dining_tables (shop_id, table_no, label, is_active)
         SELECT s.id, g, 'Table ' || g, true
         FROM shops s CROSS JOIN generate_series(1, $1::int) AS g
         WHERE s.kind = 'canteen'
         ON CONFLICT (shop_id, table_no) DO UPDATE SET is_active = true, updated_at = now()`,
        [tableCount]
      );
      await c.query(
        `UPDATE dining_tables SET is_active = false, updated_at = now()
         WHERE shop_id = (SELECT id FROM shops WHERE kind = 'canteen') AND table_no > $1`,
        [tableCount]
      );
    }
    if (b.canteenName) await c.query("UPDATE shops SET display_name = $1, updated_at = now() WHERE kind = 'canteen'", [b.canteenName]);
    if (b.groceryName) await c.query("UPDATE shops SET display_name = $1, updated_at = now() WHERE kind = 'grocery'", [b.groceryName]);
    await emit(c, "settings.changed", "settings", null, {});
    if (template?.applied) await emit(c, "catalog.changed", "catalog", null, {});
    await audit(c, { type: "staff", staffId: staff.id }, "settings.update", "settings", null, b as Record<string, unknown>);
  });
  return ok({ settings: await shopSettingsDTO(), ...(template ? { template } : {}) });
});
