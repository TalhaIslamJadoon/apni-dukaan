import { handler, ok, body } from "@/server/http";
import { getStaff, requireOwner } from "@/server/auth";
import { upsertHead, deleteHead } from "@/server/services/catalogAdmin";

export const dynamic = "force-dynamic";

export const PATCH = handler(async (req, ctx: { params: Promise<{ headId: string }> }) => {
  requireOwner(await getStaff(req));
  const { headId } = await ctx.params;
  const input = await body<any>(req);
  return ok(await upsertHead({ ...input, id: headId }));
});

export const DELETE = handler(async (req, ctx: { params: Promise<{ headId: string }> }) => {
  requireOwner(await getStaff(req));
  const { headId } = await ctx.params;
  await deleteHead(headId);
  return ok({ deleted: true });
});
