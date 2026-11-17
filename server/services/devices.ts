// ── Printers & Devices (Device Setup — owner screen) ────────────────────────
// Talha's rule: printer pairing / scanner / device attach must be EASY —
// everything from inside the system, in simple words, for a non-technical
// owner. The print AGENT discovers the printers it can reach (Windows
// spooler names + its configured endpoints) and reports them in every
// heartbeat (print_agents.available_printers). The owner only PICKS one
// printer per role from a dropdown — names/IPs are never typed by hand.
//
// An assignment is a `printers` row (role + display_name + agent_id). Jobs
// created for that role carry printer_id (the bills/labels routes already
// pick the active row for the role), the claim flow hands the job to that
// agent, and the agent prints to the assigned NAME (see resolvePrinter in
// the print agent — a server-assigned printer beats the local config).
import { q, one, tx, ApiError } from "../db";
import { emit } from "../events";

export type PrinterRole = "receipt" | "kitchen" | "label";
export const PRINTER_ROLES: PrinterRole[] = ["receipt", "kitchen", "label"];
const JOB_TYPE_OF: Record<PrinterRole, string> = {
  receipt: "receipt",
  kitchen: "kitchen_ticket",
  label: "barcode_label",
};

export interface PrinterPick {
  name: string;
  kind: "windows" | "tcp" | "file";
  address?: string;
}

const ONLINE_WITHIN_MS = 3 * 60 * 1000; // heartbeat har ~60s — 3 min = online

export async function devicesState() {
  const agents = await q<any>(
    "SELECT * FROM print_agents WHERE is_active = true ORDER BY display_name"
  );
  const printers = await q<any>(
    "SELECT * FROM printers WHERE is_active = true ORDER BY role"
  );
  const jobs = await q<any>(
    "SELECT * FROM print_jobs ORDER BY created_at DESC LIMIT 12"
  );
  const assignments: Record<PrinterRole, unknown> = { receipt: null, kitchen: null, label: null };
  for (const p of printers) {
    if ((PRINTER_ROLES as string[]).includes(p.role) && !assignments[p.role as PrinterRole]) {
      assignments[p.role as PrinterRole] = {
        printerId: p.id,
        name: p.display_name,
        agentId: p.agent_id ?? null,
        connectionType: p.connection_type,
      };
    }
  }
  return {
    agents: agents.map((a) => ({
      id: a.id,
      displayName: a.display_name,
      machineName: a.machine_name ?? null,
      version: a.version ?? null,
      lastSeenAt: a.last_seen_at ? new Date(a.last_seen_at).toISOString() : null,
      online: !!a.last_seen_at && Date.now() - new Date(a.last_seen_at).getTime() < ONLINE_WITHIN_MS,
      availablePrinters: Array.isArray(a.available_printers) ? a.available_printers : [],
    })),
    assignments,
    recentJobs: jobs.map((j) => ({
      id: j.id,
      type: j.job_type,
      status: j.status,
      isTest: !!(j.payload && (j.payload as { test?: boolean }).test),
      lastError: j.last_error ?? null,
      createdAt: new Date(j.created_at).toISOString(),
    })),
  };
}

export async function saveAssignments(
  agentId: string,
  picks: Partial<Record<PrinterRole, PrinterPick | null>>
) {
  const agent = await one<any>("SELECT id FROM print_agents WHERE id = $1 AND is_active = true", [agentId]);
  if (!agent) throw new ApiError(404, "AGENT_NOT_FOUND", "Print program (agent) nahi mila");
  await tx(async (c) => {
    for (const role of PRINTER_ROLES) {
      if (!(role in picks)) continue; // jo role bheja hi nahi, use na chheren
      const pick = picks[role];
      await c.query(
        "UPDATE printers SET is_active = false, updated_at = now() WHERE role = $1 AND is_active = true",
        [role]
      );
      if (pick) {
        const isTcp = pick.kind === "tcp";
        await c.query(
          `INSERT INTO printers (role, display_name, connection_type, address, agent_id, command_language)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            role,
            pick.name.slice(0, 200),
            isTcp ? "network_tcp" : "windows_usb",
            isTcp ? (pick.address ?? null) : pick.name.slice(0, 200),
            agentId,
            role === "label" ? null : "escpos",
          ]
        );
      }
    }
  });
  return devicesState();
}

// Ek chhoti test print job — receipt: "✅ Test Print" slip (Cash, taake cash
// drawer bhi test ho jaye); kitchen: ek line ki ticket; label: asli Code128
// wala test sticker. Job usi role ke assigned printer par jata hai.
export async function createTestPrintJob(role: PrinterRole, staffId: string) {
  if (!PRINTER_ROLES.includes(role)) throw new ApiError(400, "BAD_ROLE", "Role ghalat hai");
  const printer = await one<any>(
    "SELECT id FROM printers WHERE role = $1 AND is_active = true LIMIT 1",
    [role]
  );
  const now = new Date().toISOString();
  let payload: Record<string, unknown>;
  if (role === "receipt") {
    payload = {
      test: true,
      billNo: "TEST",
      orders: [{
        billNo: "TEST", mode: "canteen", token: 0, source: "counter", status: "ready",
        createdAt: now, cashier: "Owner (Test)", payment: "Cash", tendered: 0, change: 0,
        subtotal: 0, discount: 0, total: 0,
        lines: [{ itemId: "test-print", name: "Test Print — bill printer theek hai", price: 0, qty: 1 }],
      }],
    };
  } else if (role === "kitchen") {
    payload = {
      test: true,
      orders: [{
        token: 0, source: "counter", status: "ready", createdAt: now,
        lines: [{ itemId: "test-print", name: "Test Print — kitchen printer theek hai", price: 0, qty: 1 }],
      }],
    };
  } else {
    payload = {
      test: true,
      labels: [{ name: "Test Sticker — Apni Dukaan", price: 0, code: "TEST123456", sku: "TEST", widthMm: 50, heightMm: 30 }],
    };
  }
  const jobType = JOB_TYPE_OF[role];
  const job = await tx(async (c) => {
    const ins = await c.query(
      `INSERT INTO print_jobs (idempotency_key, printer_id, job_type, payload, requested_by_staff_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, status`,
      [`test:${jobType}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
       printer?.id ?? null, jobType, JSON.stringify(payload), staffId]
    );
    await emit(c, "print_job.changed", "print_job", ins.rows[0].id, { payload: { status: "queued" } });
    return ins.rows[0];
  });
  return { jobId: job.id as string, status: job.status as string, printerAssigned: !!printer };
}
