// ─────────────────────────────────────────────────────────────────────────────
// Rentals (Kiraya) — server service (Phase 2).
//
// Items are UNIQUE pieces ya counted samaan (dresses total_qty=1; lights /
// sajawat dholki waghera total_qty>1) with a status + category (shadi ka
// function: Baraat / Walima / Mehndi / … / Lights / Sign Boards). A booking
// reserves `qty` pieces the moment it is created (same immediate-reservation
// rule as the unique-piece flow); availability = total_qty − Σ qty of
// bookings in (booked, out).
//
// Money (integer paisa everywhere): advance → advance_date; baqaya →
// balance_date; late fine + damage → settled_date. These cash-basis dates
// drive Owner Overview income and the P&L rental bikri. The security deposit
// is NEVER income — it is held and refunded minus katoti at return.
//
// Item status is RECOMPUTED from bookings after every change (except when
// the owner parked the item in cleaning/inactive, or a unique piece goes to
// dry-clean on return).
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { q, one, tx, ApiError, businessDate, paisa } from "../db";
import { emit, audit } from "../events";
import { nextCounterValue } from "./numbering";
import type { StaffPrincipal } from "../auth";

export type RentalItemStatus = "available" | "booked" | "out" | "cleaning" | "inactive";
export type RentalBookingStatus = "booked" | "out" | "completed" | "cancelled";
export type SecurityKind = "Cash" | "CNIC" | "Cheque";
export type ReturnCondition = "theek" | "damage" | "cleaning";

export interface RentalItemDTO {
  id: string;
  name: string;
  category?: string;
  totalQty: number;
  bookedQty: number; // active bookings ki kul qty (availability hisaab ke liye)
  size?: string;
  color?: string;
  rentPerDay: number; // rupees
  securityDeposit: number; // rupees
  offerRentPerDay?: number; // rupees — grocery offerPrice wala hi rule
  boardOffer?: boolean;
  emoji?: string;
  image?: string; // pehli (main) photo — back-compat
  images: string[]; // saari photos (max 16) — board photo-spin ke liye
  status: RentalItemStatus;
}

export interface RentalBookingDTO {
  id: string;
  bookingNo: string;
  itemId: string;
  itemName: string;
  qty: number;
  customerName: string;
  customerMobile: string;
  customerCnic?: string;
  pickupDate: string;
  returnDate: string;
  days: number;
  rentPerDay: number; // rupees — CHARGE hua rate
  listRentPerDay?: number; // rupees — offer par asal rate (snapshot)
  rentTotal: number; // rupees
  securityDeposit: number; // rupees
  securityKind: SecurityKind;
  advancePaid: number; // rupees
  balancePaid: number; // rupees
  status: RentalBookingStatus;
  pickedUpAt?: string;
  returnedAt?: string;
  actualReturnDate?: string;
  lateDays?: number;
  lateFinePerDay: number; // rupees (booking ke waqt ka snapshot)
  lateFine?: number;
  damageCharges?: number;
  damageNote?: string;
  returnCondition?: ReturnCondition;
  securityDeducted?: number;
  securityRefunded?: number;
  extraDue?: number;
  createdAt: string;
  by?: string;
}

const ITEM_STATUSES: RentalItemStatus[] = ["available", "booked", "out", "cleaning", "inactive"];
const BOOKING_STATUSES: RentalBookingStatus[] = ["booked", "out", "completed", "cancelled"];
const SECURITY_KINDS: SecurityKind[] = ["Cash", "CNIC", "Cheque"];
const RETURN_CONDITIONS: ReturnCondition[] = ["theek", "damage", "cleaning"];
const MAX_RENTAL_PHOTOS = 16;

type Row = Record<string, unknown>;

function dstr(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? "").slice(0, 10);
}
function tstr(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
function rs(paisaVal: unknown): number {
  return Math.round(Number(paisaVal ?? 0) / 100);
}
function cleanImages(input: unknown, fallback?: string | null): string[] {
  const arr = Array.isArray(input) ? input : [];
  const out: string[] = [];
  for (const v of arr) {
    if (typeof v === "string" && v.trim() && !out.includes(v.trim())) out.push(v.trim());
    if (out.length >= MAX_RENTAL_PHOTOS) break;
  }
  if (!out.length && typeof fallback === "string" && fallback) out.push(fallback);
  return out;
}

const ITEM_SELECT = `SELECT i.*,
  COALESCE((SELECT SUM(b.qty) FROM rental_bookings b
             WHERE b.item_id = i.id AND b.status IN ('booked','out')), 0) AS booked_qty
  FROM rental_items i`;

function itemDTO(r: Row): RentalItemDTO {
  const images = cleanImages(r.image_urls, (r.image_url as string) ?? null);
  const offer = r.offer_rent_per_day_paisa == null ? undefined : rs(r.offer_rent_per_day_paisa);
  return {
    id: String(r.legacy_id),
    name: String(r.name),
    category: r.category ? String(r.category) : undefined,
    totalQty: Math.max(1, Number(r.total_qty ?? 1)),
    bookedQty: Number(r.booked_qty ?? 0),
    size: r.size ? String(r.size) : undefined,
    color: r.color ? String(r.color) : undefined,
    rentPerDay: rs(r.rent_per_day_paisa),
    securityDeposit: rs(r.security_deposit_paisa),
    offerRentPerDay: offer && offer > 0 ? offer : undefined,
    boardOffer: r.board_offer === true,
    emoji: r.emoji ? String(r.emoji) : undefined,
    image: images[0],
    images,
    status: String(r.status) as RentalItemStatus,
  };
}

const BOOKING_SELECT = `SELECT b.*, i.legacy_id AS item_legacy,
  s.display_name AS staff_name FROM rental_bookings b
  JOIN rental_items i ON i.id = b.item_id
  LEFT JOIN staff_users s ON s.id = b.created_by_staff_id`;

function bookingDTO(r: Row): RentalBookingDTO {
  const opt = (v: unknown) => (v == null ? undefined : rs(v));
  const listRent = r.list_rent_per_day_paisa == null ? undefined : rs(r.list_rent_per_day_paisa);
  return {
    id: String(r.legacy_id),
    bookingNo: String(r.booking_no),
    itemId: String(r.item_legacy),
    itemName: String(r.item_name),
    qty: Math.max(1, Number(r.qty ?? 1)),
    customerName: String(r.customer_name),
    customerMobile: String(r.customer_mobile),
    customerCnic: r.customer_cnic ? String(r.customer_cnic) : undefined,
    pickupDate: dstr(r.pickup_date),
    returnDate: dstr(r.return_date),
    days: Number(r.days),
    rentPerDay: rs(r.rent_per_day_paisa),
    listRentPerDay: listRent && listRent > 0 ? listRent : undefined,
    rentTotal: rs(r.rent_total_paisa),
    securityDeposit: rs(r.security_deposit_paisa),
    securityKind: String(r.security_kind) as SecurityKind,
    advancePaid: rs(r.advance_paid_paisa),
    balancePaid: rs(r.balance_paid_paisa),
    status: String(r.status) as RentalBookingStatus,
    pickedUpAt: tstr(r.picked_up_at),
    returnedAt: tstr(r.returned_at),
    actualReturnDate: r.actual_return_date ? dstr(r.actual_return_date) : undefined,
    lateDays: r.late_days == null ? undefined : Number(r.late_days),
    lateFinePerDay: rs(r.late_fine_per_day_paisa),
    lateFine: opt(r.late_fine_paisa),
    damageCharges: opt(r.damage_charges_paisa),
    damageNote: r.damage_note ? String(r.damage_note) : undefined,
    returnCondition: r.return_condition ? (String(r.return_condition) as ReturnCondition) : undefined,
    securityDeducted: opt(r.security_deducted_paisa),
    securityRefunded: opt(r.security_refunded_paisa),
    extraDue: opt(r.extra_due_paisa),
    createdAt: tstr(r.created_at) ?? new Date().toISOString(),
    by: r.staff_name ? String(r.staff_name) : undefined,
  };
}

export async function listRentalItems(): Promise<RentalItemDTO[]> {
  const rows = await q<Row>(`${ITEM_SELECT} ORDER BY i.created_at, i.legacy_id`);
  return rows.map(itemDTO);
}

export async function listRentalBookings(): Promise<RentalBookingDTO[]> {
  const rows = await q<Row>(`${BOOKING_SELECT} ORDER BY b.created_at DESC`);
  return rows.map(bookingDTO);
}

async function itemRowByLegacy(legacyId: string): Promise<Row | null> {
  return one<Row>(`${ITEM_SELECT} WHERE i.legacy_id = $1`, [legacyId]);
}

/** Item ki status bookings se dobara gin kar set karo. Owner-parked
 *  (cleaning/inactive) status ko haath nahi lagate — siwaye jab return par
 *  unique piece khud cleaning gaya ho (forceCleaning). */
async function syncItemStatus(c: PoolClient, itemUuid: string, opts?: { forceCleaning?: boolean }): Promise<void> {
  const res = await c.query(`SELECT total_qty, status FROM rental_items WHERE id = $1 FOR UPDATE`, [itemUuid]);
  const item = res.rows[0] as { total_qty: number; status: string } | undefined;
  if (!item) return;
  if (opts?.forceCleaning && Number(item.total_qty) <= 1) {
    await c.query(`UPDATE rental_items SET status = 'cleaning', updated_at = now() WHERE id = $1`, [itemUuid]);
    return;
  }
  if (item.status === "cleaning" || item.status === "inactive") return;
  const agg = await c.query(
    `SELECT COALESCE(SUM(qty) FILTER (WHERE status = 'booked'), 0) AS bq,
            COALESCE(SUM(qty) FILTER (WHERE status = 'out'), 0) AS oq
       FROM rental_bookings WHERE item_id = $1 AND status IN ('booked','out')`,
    [itemUuid],
  );
  const booked = Number(agg.rows[0].bq);
  const out = Number(agg.rows[0].oq);
  let status: RentalItemStatus = "available";
  if (Number(item.total_qty) > 1) status = booked + out >= Number(item.total_qty) ? "booked" : "available";
  else if (out > 0) status = "out";
  else if (booked > 0) status = "booked";
  await c.query(`UPDATE rental_items SET status = $2, updated_at = now() WHERE id = $1`, [itemUuid, status]);
}

/** Active bookings ki qty (ek booking ko exclude karke — update ke liye). */
async function usedQty(c: PoolClient, itemUuid: string, excludeBookingUuid?: string): Promise<number> {
  const res = await c.query(
    `SELECT COALESCE(SUM(qty), 0) AS used FROM rental_bookings
      WHERE item_id = $1 AND status IN ('booked','out') AND ($2::uuid IS NULL OR id <> $2)`,
    [itemUuid, excludeBookingUuid ?? null],
  );
  return Number(res.rows[0].used);
}

// ── Items CRUD (owner) ────────────────────────────────────────────────────────

export interface RentalItemInput {
  id?: string;
  name?: string;
  category?: string;
  totalQty?: number;
  size?: string;
  color?: string;
  rentPerDay?: number;
  securityDeposit?: number;
  offerRentPerDay?: number | null;
  boardOffer?: boolean;
  emoji?: string;
  image?: string;
  images?: string[];
  status?: string;
}

function cleanItemInput(input: RentalItemInput) {
  const name = String(input.name ?? "").trim();
  if (!name) throw new ApiError(400, "VALIDATION", "Dress/item ka naam lazmi hai.");
  const rentPerDay = Math.round(Number(input.rentPerDay ?? 0));
  const securityDeposit = Math.round(Number(input.securityDeposit ?? 0));
  if (!(rentPerDay > 0)) throw new ApiError(400, "VALIDATION", "Roz ka kiraya 0 se zyada rakhein.");
  if (securityDeposit < 0) throw new ApiError(400, "VALIDATION", "Security deposit negative nahi ho sakta.");
  const offerRaw = input.offerRentPerDay == null ? null : Math.round(Number(input.offerRentPerDay));
  const offer = offerRaw != null && offerRaw > 0 ? offerRaw : null;
  const images = cleanImages(input.images, input.image);
  const totalQty = Math.max(1, Math.floor(Number(input.totalQty ?? 1)) || 1);
  return {
    name,
    category: String(input.category ?? "").trim() || null,
    totalQty,
    size: String(input.size ?? "").trim() || null,
    color: String(input.color ?? "").trim() || null,
    rentPaisa: paisa(rentPerDay),
    depositPaisa: paisa(securityDeposit),
    offerPaisa: offer == null ? null : paisa(offer),
    boardOffer: input.boardOffer === true,
    emoji: String(input.emoji ?? "").trim() || null,
    image: images[0] ?? null,
    images,
    status: ITEM_STATUSES.includes(input.status as RentalItemStatus) ? (input.status as RentalItemStatus) : "available",
  };
}

export async function createRentalItem(input: RentalItemInput, actor: StaffPrincipal): Promise<RentalItemDTO> {
  const v = cleanItemInput(input);
  const legacyId = String(input.id ?? "").trim() || `rent-${randomUUID().slice(0, 8)}`;
  const dto = await tx(async (c) => {
    const ins = await c.query(
      `INSERT INTO rental_items (legacy_id, name, category, total_qty, size, color, rent_per_day_paisa,
         security_deposit_paisa, offer_rent_per_day_paisa, board_offer, emoji, image_url, image_urls, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [legacyId, v.name, v.category, v.totalQty, v.size, v.color, v.rentPaisa, v.depositPaisa,
       v.offerPaisa, v.boardOffer, v.emoji, v.image, JSON.stringify(v.images), v.status],
    );
    const uuid = String(ins.rows[0].id);
    await audit(c, { type: "staff", staffId: actor.id }, "rental_item.create", "rental_item", uuid, { legacyId, name: v.name });
    await emit(c, "rentals.changed", "rental_item", uuid, { payload: { what: "item" } });
    const row = (await c.query(`${ITEM_SELECT} WHERE i.id = $1`, [uuid])).rows[0] as Row;
    return itemDTO(row);
  });
  return dto;
}

export async function updateRentalItem(legacyId: string, input: RentalItemInput, actor: StaffPrincipal): Promise<RentalItemDTO> {
  const existing = await itemRowByLegacy(legacyId);
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Rental item nahi mila.");
  const v = cleanItemInput(input);
  const uuid = String(existing.id);
  const curStatus = String(existing.status);
  if ((curStatus === "booked" || curStatus === "out") && v.status !== curStatus) {
    throw new ApiError(409, "ITEM_ON_BOOKING", "Ye dress abhi booking par hai — status abhi nahi badal sakta.");
  }
  return tx(async (c) => {
    await c.query(
      `UPDATE rental_items SET name = $2, category = $3, total_qty = $4, size = $5, color = $6,
         rent_per_day_paisa = $7, security_deposit_paisa = $8, offer_rent_per_day_paisa = $9,
         board_offer = $10, emoji = $11, image_url = $12, image_urls = $13, status = $14, updated_at = now()
       WHERE id = $1`,
      [uuid, v.name, v.category, v.totalQty, v.size, v.color, v.rentPaisa, v.depositPaisa,
       v.offerPaisa, v.boardOffer, v.emoji, v.image, JSON.stringify(v.images), v.status],
    );
    await audit(c, { type: "staff", staffId: actor.id }, "rental_item.update", "rental_item", uuid, { legacyId });
    await emit(c, "rentals.changed", "rental_item", uuid, { payload: { what: "item" } });
    const row = (await c.query(`${ITEM_SELECT} WHERE i.id = $1`, [uuid])).rows[0] as Row;
    return itemDTO(row);
  });
}

export async function deleteRentalItem(legacyId: string, actor: StaffPrincipal): Promise<void> {
  const existing = await itemRowByLegacy(legacyId);
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Rental item nahi mila.");
  const uuid = String(existing.id);
  const counts = await one<{ active: string; total: string }>(
    `SELECT COUNT(*) FILTER (WHERE status IN ('booked','out')) AS active, COUNT(*) AS total FROM rental_bookings WHERE item_id = $1`,
    [uuid],
  );
  if (Number(counts?.active ?? 0) > 0) throw new ApiError(409, "ITEM_ON_BOOKING", "Is dress ki active booking hai — pehle wo mukammal karein.");
  if (Number(counts?.total ?? 0) > 0) throw new ApiError(409, "ITEM_HAS_HISTORY", "Is dress ki purani bookings hain — delete ke bajaye status Inactive kar dein, record mehfooz rahega.");
  await tx(async (c) => {
    await c.query(`DELETE FROM rental_items WHERE id = $1`, [uuid]);
    await audit(c, { type: "staff", staffId: actor.id }, "rental_item.delete", "rental_item", uuid, { legacyId });
    await emit(c, "rentals.changed", "rental_item", uuid, { payload: { what: "item" } });
  });
}

// ── Bookings (staff with the rentals tab) ─────────────────────────────────────

export interface RentalBookingInput {
  id?: string;
  itemId?: string;
  itemName?: string;
  qty?: number;
  customerName?: string;
  customerMobile?: string;
  customerCnic?: string;
  pickupDate?: string;
  returnDate?: string;
  days?: number;
  rentPerDay?: number;
  listRentPerDay?: number | null;
  rentTotal?: number;
  securityDeposit?: number;
  securityKind?: string;
  advancePaid?: number;
  balancePaid?: number;
  status?: string;
  pickedUpAt?: string;
  returnedAt?: string;
  actualReturnDate?: string;
  lateDays?: number;
  lateFinePerDay?: number;
  lateFine?: number;
  damageCharges?: number;
  damageNote?: string;
  returnCondition?: string;
  securityDeducted?: number;
  securityRefunded?: number;
  extraDue?: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function createRentalBooking(input: RentalBookingInput, actor: StaffPrincipal): Promise<RentalBookingDTO> {
  const customerName = String(input.customerName ?? "").trim();
  const customerMobile = String(input.customerMobile ?? "").trim();
  if (!customerName) throw new ApiError(400, "VALIDATION", "Customer ka naam lazmi hai.");
  if (!customerMobile) throw new ApiError(400, "VALIDATION", "Customer ka mobile number lazmi hai.");
  const pickupDate = String(input.pickupDate ?? "");
  const returnDate = String(input.returnDate ?? "");
  if (!DATE_RE.test(pickupDate) || !DATE_RE.test(returnDate)) throw new ApiError(400, "VALIDATION", "Lene/wapsi ki tareekh durust nahi.");
  const days = Math.max(1, Math.round(Number(input.days ?? 0)) || Math.round((Date.parse(returnDate) - Date.parse(pickupDate)) / 86400000));
  if (!(days >= 1)) throw new ApiError(400, "VALIDATION", "Wapsi ki tareekh lene ki tareekh ke baad ho.");
  const qty = Math.max(1, Math.floor(Number(input.qty ?? 1)) || 1);
  const rentTotal = Math.round(Number(input.rentTotal ?? 0));
  const advance = Math.round(Number(input.advancePaid ?? 0));
  if (rentTotal < 0 || advance < 0 || advance > rentTotal) throw new ApiError(400, "VALIDATION", "Advance kiraya se zyada nahi ho sakta.");
  const itemLegacy = String(input.itemId ?? "");
  const today = businessDate();

  return tx(async (c) => {
    const itemRes = await c.query(`SELECT id, name, total_qty, status FROM rental_items WHERE legacy_id = $1 FOR UPDATE`, [itemLegacy]);
    const item = itemRes.rows[0] as { id: string; name: string; total_qty: number; status: string } | undefined;
    if (!item) throw new ApiError(404, "NOT_FOUND", "Rental item nahi mila.");
    if (item.status === "inactive" || item.status === "cleaning") {
      throw new ApiError(409, "ITEM_NOT_AVAILABLE", "Ye item abhi rent ke liye available nahi hai.");
    }
    const used = await usedQty(c, String(item.id));
    if (qty > Number(item.total_qty) - used) {
      throw new ApiError(409, "QTY_NOT_AVAILABLE", `Sirf ${Math.max(0, Number(item.total_qty) - used)} piece available hain — itni qty book nahi ho sakti.`);
    }
    const seq = await nextCounterValue(c, "rental-booking");
    const bookingNo = `R-${String(seq).padStart(4, "0")}`;
    const legacyId = String(input.id ?? "").trim() || `rb-${randomUUID().slice(0, 8)}`;
    const kind = SECURITY_KINDS.includes(input.securityKind as SecurityKind) ? (input.securityKind as SecurityKind) : "Cash";
    const ins = await c.query(
      `INSERT INTO rental_bookings (legacy_id, booking_no, item_id, item_name, qty, customer_name, customer_mobile,
         customer_cnic, pickup_date, return_date, days, rent_per_day_paisa, list_rent_per_day_paisa,
         rent_total_paisa, security_deposit_paisa, security_kind, advance_paid_paisa, balance_paid_paisa,
         status, advance_date, late_fine_per_day_paisa, created_by_staff_id)
       VALUES ($1,$2,$3,$20,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,0,'booked',$17,
         COALESCE($19, (SELECT rental_late_fine_per_day_paisa FROM system_settings WHERE id = true)), $18) RETURNING id`,
      [legacyId, bookingNo, item.id, qty, customerName, customerMobile,
       String(input.customerCnic ?? "").trim() || null, pickupDate, returnDate, days,
       paisa(Math.round(Number(input.rentPerDay ?? 0))),
       input.listRentPerDay != null && Number(input.listRentPerDay) > 0 ? paisa(Math.round(Number(input.listRentPerDay))) : null,
       paisa(rentTotal), paisa(Math.round(Number(input.securityDeposit ?? 0))), kind, paisa(advance),
       advance > 0 ? today : null, actor.id,
       input.lateFinePerDay != null ? paisa(Math.round(Number(input.lateFinePerDay))) : null,
       String(input.itemName ?? "").trim() || String(item.name)],
    );
    const bookingUuid = String(ins.rows[0].id);
    await syncItemStatus(c, String(item.id));
    await audit(c, { type: "staff", staffId: actor.id }, "rental_booking.create", "rental_booking", bookingUuid, { bookingNo, itemLegacy, qty });
    await emit(c, "rentals.changed", "rental_booking", bookingUuid, { payload: { what: "booking" } });
    const dtoRow = (await c.query(`${BOOKING_SELECT} WHERE b.id = $1`, [bookingUuid])).rows[0] as Row;
    return bookingDTO(dtoRow);
  });
}

export async function updateRentalBooking(legacyId: string, input: RentalBookingInput, actor: StaffPrincipal): Promise<RentalBookingDTO> {
  const status = BOOKING_STATUSES.includes(input.status as RentalBookingStatus) ? (input.status as RentalBookingStatus) : undefined;
  const today = businessDate();
  return tx(async (c) => {
    const curRes = await c.query(`SELECT * FROM rental_bookings WHERE legacy_id = $1 FOR UPDATE`, [legacyId]);
    const cur = curRes.rows[0] as Row | undefined;
    if (!cur) throw new ApiError(404, "NOT_FOUND", "Booking nahi mili.");
    const curStatus = String(cur.status) as RentalBookingStatus;
    if (curStatus === "completed" || curStatus === "cancelled") {
      throw new ApiError(409, "BOOKING_CLOSED", "Ye booking mukammal/band ho chuki hai — ab tabdeeli nahi ho sakti.");
    }
    const nextStatus = status ?? curStatus;
    const qty = Math.max(1, Math.floor(Number(input.qty ?? cur.qty ?? 1)) || 1);
    if (nextStatus === "booked" || nextStatus === "out") {
      const itemRes = await c.query(`SELECT total_qty FROM rental_items WHERE id = $1`, [String(cur.item_id)]);
      const totalQty = Number(itemRes.rows[0].total_qty);
      const usedOthers = await usedQty(c, String(cur.item_id), String(cur.id));
      if (qty > totalQty - usedOthers) {
        throw new ApiError(409, "QTY_NOT_AVAILABLE", `Sirf ${Math.max(0, totalQty - usedOthers)} piece available hain — itni qty nahi ho sakti.`);
      }
    }
    const balance = Math.round(Number(input.balancePaid ?? rs(cur.balance_paid_paisa)));
    const balanceDate = balance > 0 ? (cur.balance_date ? dstr(cur.balance_date) : today) : (cur.balance_date ? dstr(cur.balance_date) : null);
    await c.query(
      `UPDATE rental_bookings SET qty = $2, status = $3, balance_paid_paisa = $4, balance_date = $5,
         picked_up_at = $6, returned_at = $7, actual_return_date = $8, late_days = $9,
         late_fine_paisa = $10, damage_charges_paisa = $11, damage_note = $12, return_condition = $13,
         security_deducted_paisa = $14, security_refunded_paisa = $15, extra_due_paisa = $16, settled_date = $17,
         updated_at = now()
       WHERE id = $1`,
      [String(cur.id), qty, nextStatus, paisa(balance), balanceDate,
       input.pickedUpAt ?? (cur.picked_up_at ? tstr(cur.picked_up_at) : null),
       input.returnedAt ?? (cur.returned_at ? tstr(cur.returned_at) : null),
       input.actualReturnDate ?? (cur.actual_return_date ? dstr(cur.actual_return_date) : null),
       input.lateDays ?? (cur.late_days == null ? null : Number(cur.late_days)),
       input.lateFine != null ? paisa(Math.round(Number(input.lateFine))) : (cur.late_fine_paisa == null ? null : Number(cur.late_fine_paisa)),
       input.damageCharges != null ? paisa(Math.round(Number(input.damageCharges))) : (cur.damage_charges_paisa == null ? null : Number(cur.damage_charges_paisa)),
       input.damageNote ?? (cur.damage_note ? String(cur.damage_note) : null),
       RETURN_CONDITIONS.includes(input.returnCondition as ReturnCondition) ? input.returnCondition : (cur.return_condition ? String(cur.return_condition) : null),
       input.securityDeducted != null ? paisa(Math.round(Number(input.securityDeducted))) : (cur.security_deducted_paisa == null ? null : Number(cur.security_deducted_paisa)),
       input.securityRefunded != null ? paisa(Math.round(Number(input.securityRefunded))) : (cur.security_refunded_paisa == null ? null : Number(cur.security_refunded_paisa)),
       input.extraDue != null ? paisa(Math.round(Number(input.extraDue))) : (cur.extra_due_paisa == null ? null : Number(cur.extra_due_paisa)),
       nextStatus === "completed" ? today : (cur.settled_date ? dstr(cur.settled_date) : null)],
    );
    const forceCleaning = nextStatus === "completed" && input.returnCondition === "cleaning";
    await syncItemStatus(c, String(cur.item_id), { forceCleaning });
    await audit(c, { type: "staff", staffId: actor.id }, "rental_booking.update", "rental_booking", String(cur.id), { legacyId, status: nextStatus, qty });
    await emit(c, "rentals.changed", "rental_booking", String(cur.id), { payload: { what: "booking" } });
    const dtoRow = (await c.query(`${BOOKING_SELECT} WHERE b.id = $1`, [String(cur.id)])).rows[0] as Row;
    return bookingDTO(dtoRow);
  });
}

export async function deleteRentalBooking(legacyId: string, actor: StaffPrincipal): Promise<void> {
  await tx(async (c) => {
    const curRes = await c.query(`SELECT id, item_id FROM rental_bookings WHERE legacy_id = $1 FOR UPDATE`, [legacyId]);
    const cur = curRes.rows[0] as { id: string; item_id: string } | undefined;
    if (!cur) throw new ApiError(404, "NOT_FOUND", "Booking nahi mili.");
    await c.query(`DELETE FROM rental_bookings WHERE id = $1`, [cur.id]);
    await syncItemStatus(c, String(cur.item_id));
    await audit(c, { type: "staff", staffId: actor.id }, "rental_booking.delete", "rental_booking", String(cur.id), { legacyId });
    await emit(c, "rentals.changed", "rental_booking", String(cur.id), { payload: { what: "booking" } });
  });
}
