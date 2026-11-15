import { handler, ok, body } from "@/server/http";
import { getStaff, requireOwner } from "@/server/auth";
import { devicesState, saveAssignments, PRINTER_ROLES, type PrinterPick, type PrinterRole } from "@/server/services/devices";
import { ApiError } from "@/server/db";

export const dynamic = "force-dynamic";

// GET /api/v1/owner/devices — Printers & Devices screen ka poora state:
// agent (print program) online hai ya nahi, us ke paas kaun se printers
// mile, har role (bill/kitchen/label) par kaun sa printer laga hai, aur
// haal ki print jobs (test print ki halat simple alfaz mein UI dikhati hai).
export const GET = handler(async (req) => {
  requireOwner(await getStaff(req));
  return ok(await devicesState());
});

// PUT /api/v1/owner/devices { agentId, assignments: { receipt?, kitchen?, label? } }
// Har role ka pick ya to { name, kind, address? } hai ya null ("Koi nahi").
// Sirf bheje gaye roles badalte hain.
export const PUT = handler(async (req) => {
  requireOwner(await getStaff(req));
  const b = await body<{ agentId?: string; assignments?: Partial<Record<PrinterRole, PrinterPick | null>> }>(req);
  if (!b.agentId) throw new ApiError(400, "AGENT_REQUIRED", "Print program (agent) chunein");
  const picks: Partial<Record<PrinterRole, PrinterPick | null>> = {};
  for (const role of PRINTER_ROLES) {
    if (!b.assignments || !(role in b.assignments)) continue;
    const p = b.assignments[role];
    if (p === null) { picks[role] = null; continue; }
    if (!p || typeof p.name !== "string" || !p.name.trim()) {
      throw new ApiError(400, "BAD_PICK", `${role} ke liye printer ka naam ghalat hai`);
    }
    picks[role] = {
      name: p.name.trim(),
      kind: ["windows", "tcp", "file"].includes(p.kind) ? p.kind : "windows",
      ...(typeof p.address === "string" && p.address.trim() ? { address: p.address.trim() } : {}),
    };
  }
  return ok(await saveAssignments(b.agentId, picks));
});
