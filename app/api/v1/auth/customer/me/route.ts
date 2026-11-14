import { handler, ok, body } from "@/server/http";
import { q, ApiError } from "@/server/db";
import { getCustomer, requireCustomer } from "@/server/auth";

export const dynamic = "force-dynamic";

function dto(p: any) {
  return {
    name: p.name, mobile: p.mobile, email: p.email ?? undefined,
    emailVerified: !!p.emailVerified, mobileVerified: !!p.mobileVerified,
    placeType: p.placeType, placeDetail: p.placeDetail,
    ...(p.externalId ? { studentId: p.externalId } : {}),
    createdAt: Date.now(),
  };
}

export const GET = handler(async (req) => {
  const p = requireCustomer(await getCustomer(req));
  return ok({ account: dto(p) });
});

// PATCH — update name/place/optional ID (mobile change is staff-assisted, §4.2)
export const PATCH = handler(async (req) => {
  const p = requireCustomer(await getCustomer(req));
  const b = await body<{ name?: string; placeType?: string; placeDetail?: string; studentId?: string }>(req);
  await q(
    `UPDATE customers SET full_name = COALESCE($2, full_name), place_type = COALESCE($3, place_type),
       place_detail = COALESCE($4, place_detail), external_student_staff_id = $5, updated_at = now() WHERE id = $1`,
    [p.id, b.name?.trim() || null, b.placeType || null, b.placeDetail ?? null, b.studentId !== undefined ? (b.studentId.trim() || null) : p.externalId]
  );
  const fresh = requireCustomer(await getCustomer(req));
  return ok({ account: dto(fresh) });
});
