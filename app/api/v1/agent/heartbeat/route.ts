import { handler, ok, body } from "@/server/http";
import { q } from "@/server/db";
import { getPrintAgent, requirePrintAgent } from "@/server/auth";

export const dynamic = "force-dynamic";

// POST /api/v1/agent/heartbeat { machineName?, version?, printers? }
// Print-agent liveness ping (plan §1.5/§1.8 — the owner health view reads
// print_agents.last_seen_at). `printers` is the agent's DISCOVERED printer
// list ([{ name, kind, address? }] — Windows spooler names + configured
// endpoints); it is stored on the agent row so the owner's Devices screen
// can offer real dropdowns instead of typed names/IPs. Returns the printers
// assigned to this agent so the agent can validate its local config.
interface ReportedPrinter { name: string; kind: string; address?: string }
export const POST = handler(async (req) => {
  const agent = requirePrintAgent(await getPrintAgent(req));
  const b = await body<{ machineName?: string; version?: string; printers?: ReportedPrinter[] }>(req)
    .catch(() => ({} as { machineName?: string; version?: string; printers?: ReportedPrinter[] }));
  // Sanitise the reported list: short strings only, capped at 50 entries.
  const reported = Array.isArray(b.printers)
    ? b.printers
        .filter((p) => p && typeof p.name === "string" && p.name.trim())
        .slice(0, 50)
        .map((p) => ({
          name: p.name.trim().slice(0, 200),
          kind: ["windows", "tcp", "file"].includes(p.kind) ? p.kind : "windows",
          ...(typeof p.address === "string" && p.address.trim() ? { address: p.address.trim().slice(0, 200) } : {}),
        }))
    : null;
  await q(
    `UPDATE print_agents SET last_seen_at = now(),
       machine_name = COALESCE($2, machine_name), version = COALESCE($3, version),
       available_printers = COALESCE($4::jsonb, available_printers)
     WHERE id = $1`,
    [agent.id, b.machineName ?? null, b.version ?? null, reported ? JSON.stringify(reported) : null]
  );
  const printers = await q<any>(
    "SELECT * FROM printers WHERE agent_id = $1 AND is_active = true ORDER BY role",
    [agent.id]
  );
  return ok({
    ok: true,
    agent: { id: agent.id, displayName: agent.displayName },
    printers: printers.map((p) => ({
      id: p.id, role: p.role, displayName: p.display_name,
      connectionType: p.connection_type, address: p.address ?? null,
      commandLanguage: p.command_language ?? null,
      paperWidthMm: p.paper_width_mm ?? null,
      labelWidthMm: p.label_width_mm ?? null,
      labelHeightMm: p.label_height_mm ?? null,
    })),
  });
});
