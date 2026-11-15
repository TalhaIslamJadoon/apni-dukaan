// Owner services: dashboard aggregates, Udhaar ledger, dining tables and
// running table-session settlement (plan §4.3E, §1.6, Step 8/9).
import type { PoolClient } from "pg";
import { tx, q, one, ApiError, businessDate, rupees, paisa } from "../db";
import { emit, audit } from "../events";
import type { StaffPrincipal } from "../auth";
import crypto from "node:crypto";

// ── Dashboard ────────────────────────────────────────────────────────────────
export async function dashboard(date?: string): Promise<Record<string, unknown>> {
  const d = date ?? businessDate();
  const totals = await one<any>(
    `SELECT COUNT(*)::int AS orders,
       COALESCE(SUM(total_paisa) FILTER (WHERE status <> 'cancelled'),0) AS total,
       COALESCE(SUM(total_paisa) FILTER (WHERE status <> 'cancelled' AND s.kind='canteen'),0) AS canteen,
       COALESCE(SUM(total_paisa) FILTER (WHERE status <> 'cancelled' AND s.kind='grocery'),0) AS grocery,
       COALESCE(SUM(total_paisa) FILTER (WHERE status <> 'cancelled' AND o.source='counter'),0) AS counter_sales,
       COALESCE(SUM(total_paisa) FILTER (WHERE status <> 'cancelled' AND o.source<>'counter' AND s.kind='canteen'),0) AS online_canteen,
       COALESCE(SUM(total_paisa) FILTER (WHERE status <> 'cancelled' AND o.source<>'counter' AND s.kind='grocery'),0) AS online_grocery,
       COUNT(*) FILTER (WHERE payment_status='proof_pending')::int AS proof_pending
     FROM orders o JOIN shops s ON s.id = o.shop_id WHERE o.business_date = $1`,
    [d]
  );
  const byMethod = await q<any>(
    `SELECT method, COALESCE(SUM(amount_paisa),0) AS amt FROM payments p
     JOIN bills b ON b.id = p.bill_id
     WHERE p.status = 'confirmed' AND p.payment_kind IN ('tender','udhaar_charge')
       AND b.created_at::date = $1::date
     GROUP BY method`,
    [d]
  );
  const best = await q<any>(
    `SELECT l.item_name_snapshot AS name, SUM(l.quantity) AS qty, SUM(l.line_total_paisa) AS amt
     FROM order_lines l JOIN orders o ON o.id = l.order_id
     WHERE o.business_date = $1 AND o.status <> 'cancelled'
     GROUP BY l.item_name_snapshot ORDER BY amt DESC LIMIT 10`,
    [d]
  );
  const low = await one<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM inventory_balances b
     LEFT JOIN menu_items m ON m.id = b.menu_item_id
     LEFT JOIN grocery_products p ON p.id = b.grocery_product_id
     WHERE b.quantity_on_hand <= COALESCE(m.low_stock_qty, p.low_stock_qty, 5)`
  );
  const methods: Record<string, number> = {};
  for (const r of byMethod) methods[r.method] = rupees(Number(r.amt));
  return {
    date: d,
    orderCount: totals?.orders ?? 0,
    totalSales: rupees(Number(totals?.total ?? 0)),
    canteenSales: rupees(Number(totals?.canteen ?? 0)),
    grocerySales: rupees(Number(totals?.grocery ?? 0)),
    counterSales: rupees(Number(totals?.counter_sales ?? 0)),
    onlineCanteenSales: rupees(Number(totals?.online_canteen ?? 0)),
    onlineGrocerySales: rupees(Number(totals?.online_grocery ?? 0)),
    paymentsByMethod: methods,
    proofPendingCount: totals?.proof_pending ?? 0,
    lowStockCount: low?.n ?? 0,
    bestSellers: best.map((b) => ({ name: b.name, qty: Number(b.qty), amount: rupees(Number(b.amt)) })),
  };
}

// ── Udhaar ───────────────────────────────────────────────────────────────────
export async function udhaarAccounts(): Promise<Record<string, unknown>[]> {
  const rows = await q<any>(
    `SELECT a.*, COALESCE((SELECT balance_after_paisa FROM udhaar_ledger_entries e WHERE e.udhaar_account_id = a.id ORDER BY e.created_at DESC, e.id DESC LIMIT 1), 0) AS balance,
       COALESCE((SELECT SUM(e.amount_paisa) FROM udhaar_ledger_entries e WHERE e.udhaar_account_id = a.id AND e.entry_type = 'charge'), 0) AS total_charged,
       COALESCE((SELECT SUM(-e.amount_paisa) FROM udhaar_ledger_entries e WHERE e.udhaar_account_id = a.id AND e.entry_type = 'payment'), 0) AS total_paid
     FROM udhaar_accounts a WHERE a.is_active = true ORDER BY a.display_name`
  );
  return rows.map((r) => ({
    id: r.id, name: r.display_name, externalId: r.external_id, mobile: r.mobile,
    customerId: r.customer_id, balance: rupees(Number(r.balance)),
    totalCharged: rupees(Number(r.total_charged)), totalPaid: rupees(Number(r.total_paid)),
    creditLimit: r.credit_limit_paisa !== null ? rupees(r.credit_limit_paisa) : null,
  }));
}

export async function udhaarLedger(accountId: string): Promise<Record<string, unknown>[]> {
  const rows = await q<any>(
    `SELECT e.*, s.display_name AS by_name, b.bill_no AS bill_no, p.method AS pay_method
     FROM udhaar_ledger_entries e
     LEFT JOIN staff_users s ON s.id = e.created_by_staff_id
     LEFT JOIN bills b ON b.id = e.bill_id
     LEFT JOIN payments p ON p.id = e.payment_id
     WHERE e.udhaar_account_id = $1 ORDER BY e.created_at ASC`,
    [accountId]
  );
  return rows.map((r) => ({
    id: r.id, type: r.entry_type, amount: rupees(Number(r.amount_paisa)),
    balanceAfter: rupees(Number(r.balance_after_paisa)), billId: r.bill_id, billNo: r.bill_no, paymentId: r.payment_id,
    method: r.pay_method, byName: r.by_name,
    note: r.note, at: new Date(r.created_at).toISOString(),
  }));
}

async function udhaarBalance(c: PoolClient, accountId: string): Promise<number> {
  const r = await c.query(
    "SELECT balance_after_paisa FROM udhaar_ledger_entries WHERE udhaar_account_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE",
    [accountId]
  );
  return r.rows[0] ? Number(r.rows[0].balance_after_paisa) : 0;
}

export async function udhaarRepayment(accountId: string, amountRs: number, method: string, staff: StaffPrincipal, note?: string): Promise<Record<string, unknown>> {
  if (!(amountRs > 0)) throw new ApiError(400, "BAD_AMOUNT", "Amount ghalat hai");
  return tx(async (c) => {
    const acc = (await c.query("SELECT * FROM udhaar_accounts WHERE id = $1 FOR UPDATE", [accountId])).rows[0];
    if (!acc) throw new ApiError(404, "ACCOUNT_NOT_FOUND", "Udhaar account nahi mila");
    const bal = await udhaarBalance(c, accountId);
    const amt = paisa(amountRs);
    if (amt > bal) throw new ApiError(409, "OVERPAYMENT", "Payment baqaya se zyada hai — pehle owner adjustment karein", { balance: rupees(bal) });
    const pay = await c.query(
      "INSERT INTO payments (udhaar_account_id, payment_kind, method, amount_paisa, status, confirmed_by_staff_id, confirmed_at) VALUES ($1,'udhaar_repayment',$2,$3,'confirmed',$4, now()) RETURNING id",
      [accountId, method, amt, staff.id]
    );
    // allocate FIFO across open credit bills of this account
    let remaining = amt;
    const bills = await c.query(
      `SELECT b.id, b.total_paisa FROM bills b
       JOIN payments p ON p.bill_id = b.id AND p.payment_kind = 'udhaar_charge' AND p.udhaar_account_id = $1
       WHERE b.status = 'settled_on_credit' ORDER BY b.created_at ASC`,
      [accountId]
    );
    for (const b of bills.rows) {
      if (remaining <= 0) break;
      const already = await c.query("SELECT COALESCE(SUM(amount_paisa),0) AS s FROM payment_allocations WHERE bill_id = $1", [b.id]);
      const due = Number(b.total_paisa) - Number(already.rows[0].s);
      if (due <= 0) continue;
      const alloc = Math.min(due, remaining);
      await c.query("INSERT INTO payment_allocations (payment_id, bill_id, amount_paisa) VALUES ($1,$2,$3)", [pay.rows[0].id, b.id, alloc]);
      remaining -= alloc;
    }
    const newBal = bal - amt;
    await c.query(
      "INSERT INTO udhaar_ledger_entries (udhaar_account_id, entry_type, amount_paisa, balance_after_paisa, payment_id, note, created_by_staff_id) VALUES ($1,'payment',$2,$3,$4,$5,$6)",
      [accountId, -amt, newBal, pay.rows[0].id, note?.trim() ? note.trim() : null, staff.id]
    );
    await emit(c, "dashboard.changed", "dashboard", null, {});
    await audit(c, { type: "staff", staffId: staff.id }, "udhaar.repayment", "udhaar_account", accountId, { amount: amountRs, method, note: note?.trim() || undefined });
    return { accountId, balance: rupees(newBal) };
  });
}

export async function udhaarAdjustment(accountId: string, amountRs: number, note: string, staff: StaffPrincipal): Promise<Record<string, unknown>> {
  if (!note?.trim()) throw new ApiError(400, "NOTE_REQUIRED", "Adjustment ke liye wajah (note) zaroori hai");
  return tx(async (c) => {
    const acc = (await c.query("SELECT * FROM udhaar_accounts WHERE id = $1 FOR UPDATE", [accountId])).rows[0];
    if (!acc) throw new ApiError(404, "ACCOUNT_NOT_FOUND", "Udhaar account nahi mila");
    const bal = await udhaarBalance(c, accountId);
    const amt = paisa(amountRs);
    const newBal = bal + amt;
    await c.query(
      "INSERT INTO udhaar_ledger_entries (udhaar_account_id, entry_type, amount_paisa, balance_after_paisa, note, created_by_staff_id) VALUES ($1,'adjustment',$2,$3,$4,$5)",
      [accountId, amt, newBal, note, staff.id]
    );
    await audit(c, { type: "staff", staffId: staff.id }, "udhaar.adjustment", "udhaar_account", accountId, { amount: amountRs, note });
    return { accountId, balance: rupees(newBal) };
  });
}

// ── Tables & sessions ────────────────────────────────────────────────────────
export async function listTables(): Promise<Record<string, unknown>[]> {
  const rows = await q<any>(
    `SELECT t.*, s.kind AS shop_kind,
       (SELECT ts.id FROM table_sessions ts WHERE ts.table_id = t.id AND ts.status = 'open') AS open_session_id
     FROM dining_tables t JOIN shops s ON s.id = t.shop_id ORDER BY t.table_no`
  );
  return rows.map((r) => ({
    id: r.id, tableNo: r.table_no, label: r.label, shopKind: r.shop_kind,
    isActive: r.is_active, hasToken: !!r.public_token_hash, openSessionId: r.open_session_id ?? null,
  }));
}

export function newTableToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(18).toString("hex");
  return { raw, hash: crypto.createHash("sha256").update(raw).digest("hex") };
}

export async function sessionDTO(sessionId: string): Promise<Record<string, unknown> | null> {
  const s = await one<any>(
    `SELECT ts.*, t.table_no, t.label FROM table_sessions ts JOIN dining_tables t ON t.id = ts.table_id WHERE ts.id = $1`,
    [sessionId]
  );
  if (!s) return null;
  const orders = await q<any>("SELECT id FROM orders WHERE table_session_id = $1 ORDER BY created_at", [sessionId]);
  const { fetchOrderDTOById } = await import("../dto");
  const orderDTOs = [];
  for (const o of orders) orderDTOs.push(await fetchOrderDTOById(o.id));
  const total = orderDTOs.filter((o: any) => o).reduce((sum: number, o: any) => sum + Number(o.total ?? 0), 0);
  return {
    id: s.id, tableNo: s.table_no, tableLabel: s.label, status: s.status,
    guestName: s.guest_name, openedAt: new Date(s.opened_at).toISOString(),
    settledAt: s.settled_at ? new Date(s.settled_at).toISOString() : null,
    orders: orderDTOs, runningTotal: total,
  };
}

export interface SettlementPayment { method: string; amount: number; udhaarExternalId?: string; udhaarName?: string }

export async function settleSession(sessionId: string, discountRs: number, paymentsIn: SettlementPayment[], staff: StaffPrincipal): Promise<Record<string, unknown>> {
  return tx(async (c) => {
    const s = (await c.query("SELECT * FROM table_sessions WHERE id = $1 FOR UPDATE", [sessionId])).rows[0];
    if (!s) throw new ApiError(404, "SESSION_NOT_FOUND", "Table session nahi mila");
    if (s.status !== "open") throw new ApiError(409, "ALREADY_SETTLED", "Ye session pehle hi settle ho chuka hai");
    const ords = await c.query("SELECT * FROM orders WHERE table_session_id = $1 AND status <> 'cancelled' FOR UPDATE", [sessionId]);
    const subtotal = ords.rows.reduce((sum: number, o: any) => sum + Number(o.total_paisa), 0);
    const discount = Math.min(Math.max(paisa(discountRs || 0), 0), subtotal);
    const total = subtotal - discount;
    const paid = paymentsIn.reduce((sum, p) => sum + paisa(p.amount), 0);
    if (paid !== total) throw new ApiError(400, "SETTLEMENT_MISMATCH", "Payments ka total bill ke barabar hona chahiye", { total: rupees(total), paid: rupees(paid) });
    const { nextCounterBill } = await import("./numbering");
    const billNo = await nextCounterBill(c);
    const udhaarTotal = paymentsIn.filter((p) => p.method === "udhaar").reduce((sum, p) => sum + paisa(p.amount), 0);
    const bill = await c.query(
      `INSERT INTO bills (bill_no, shop_id, table_session_id, status, subtotal_paisa, discount_paisa, total_paisa,
         amount_tendered_paisa, amount_on_udhaar_paisa, created_by_staff_id, settled_by_staff_id, settled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10, now()) RETURNING id`,
      [billNo, s.shop_id, sessionId, udhaarTotal === total ? "settled_on_credit" : udhaarTotal > 0 ? "partially_settled" : "settled",
       subtotal, discount, total, total - udhaarTotal, udhaarTotal, staff.id]
    );
    const billId = bill.rows[0].id as string;
    for (const o of ords.rows) await c.query("INSERT INTO bill_orders (bill_id, order_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [billId, o.id]);
    for (const p of paymentsIn) {
      if (p.method === "udhaar") {
        const extId = p.udhaarExternalId ?? null;
        const dispName = p.udhaarName ?? s.guest_name ?? "Table Guest";
        const identityKey = extId ? `ext:${extId.trim().toLowerCase()}` : `name:${dispName.trim().toLowerCase()}|table`;
        let acc = (await c.query("SELECT * FROM udhaar_accounts WHERE identity_key = $1 FOR UPDATE", [identityKey])).rows[0];
        if (!acc) {
          acc = (await c.query("INSERT INTO udhaar_accounts (external_id, display_name, identity_key) VALUES ($1,$2,$3) RETURNING *", [extId, dispName, identityKey])).rows[0];
        }
        const pay = await c.query(
          "INSERT INTO payments (bill_id, udhaar_account_id, payment_kind, method, amount_paisa, status, confirmed_by_staff_id, confirmed_at) VALUES ($1,$2,'udhaar_charge','udhaar',$3,'confirmed',$4, now()) RETURNING id",
          [billId, acc.id, paisa(p.amount), staff.id]
        );
        const bal = await udhaarBalance(c, acc.id);
        await c.query(
          "INSERT INTO udhaar_ledger_entries (udhaar_account_id, entry_type, amount_paisa, balance_after_paisa, bill_id, payment_id, created_by_staff_id) VALUES ($1,'charge',$2,$3,$4,$5,$6)",
          [acc.id, paisa(p.amount), bal + paisa(p.amount), billId, pay.rows[0].id, staff.id]
        );
      } else {
        await c.query(
          "INSERT INTO payments (bill_id, payment_kind, method, amount_paisa, status, confirmed_by_staff_id, confirmed_at) VALUES ($1,'tender',$2,$3,'confirmed',$4, now())",
          [billId, p.method, paisa(p.amount), staff.id]
        );
      }
    }
    await c.query("UPDATE table_sessions SET status = 'settled', settled_at = now(), settlement_bill_id = $1, version = version + 1 WHERE id = $2", [billId, sessionId]);
    await emit(c, "table_session.changed", "table_session", sessionId, { shopId: s.shop_id, payload: { sessionId, status: "settled" } });
    await emit(c, "dashboard.changed", "dashboard", null, { shopId: s.shop_id });
    await audit(c, { type: "staff", staffId: staff.id }, "table_session.settle", "table_session", sessionId, { billNo, total: rupees(total) });
    return { sessionId, billId, billNo, total: rupees(total) };
  });
}

export async function reopenSession(sessionId: string, staff: StaffPrincipal): Promise<Record<string, unknown>> {
  if (!staff.isOwner) throw new ApiError(403, "FORBIDDEN", "Session reopen sirf Owner kar sakta hai");
  return tx(async (c) => {
    const s = (await c.query("SELECT * FROM table_sessions WHERE id = $1 FOR UPDATE", [sessionId])).rows[0];
    if (!s) throw new ApiError(404, "SESSION_NOT_FOUND", "Session nahi mila");
    if (s.status !== "settled") throw new ApiError(409, "NOT_SETTLED", "Sirf settled session reopen ho sakta hai");
    await c.query("UPDATE table_sessions SET status = 'open', settled_at = NULL, settlement_bill_id = NULL, version = version + 1 WHERE id = $1", [sessionId]);
    await emit(c, "table_session.changed", "table_session", sessionId, { shopId: s.shop_id, payload: { sessionId, status: "open" } });
    await audit(c, { type: "staff", staffId: staff.id }, "table_session.reopen", "table_session", sessionId, {});
    return { sessionId, status: "open" };
  });
}
