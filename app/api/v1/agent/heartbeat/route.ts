import { handler, ok, body } from "@/server/http";
import { q } from "@/server/db";
import { getPrintAgent, requirePrintAgent } from "@/server/auth";

export const dynamic = "force-dynamic";

// POST /api/v1/agent/heartbeat { machineName?, version? }
// Print-agent liveness ping (plan §1.5/§1.8 — the owner health view reads
// print_agents.last_seen_at). Returns the printers assigned to this agent so
// the agent can validate its local config against the server.
export const POST = handler(async (req) => {
  const agent = requirePrintAgent(await getPrintAgent(req));
  const b = await body<{ machineName?: string; version?: string }>(req).catch(() => ({} as { machineName?: string; version?: string }));
  await q(
    `UPDATE print_agents SET last_seen_at = now(),
       machine_name = COALESCE($2, machine_name), version = COALESCE($3, version)
     WHERE id = $1`,
    [agent.id, b.machineName ?? null, b.version ?? null]
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
