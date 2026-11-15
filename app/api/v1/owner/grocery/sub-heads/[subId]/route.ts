import { handler, ok, body } from "@/server/http";
import { getStaff, requireOwner } from "@/server/auth";
import { upsertSubHead, deleteSubHead } from "@/server/services/catalogAdmin";

export const dynamic = "force-dynamic";

export const PATCH = handler(async (req, ctx: { params: Promise<{ subId: string }> }) => {
  requireOwner(await getStaff(req));
  const { subId } = await ctx.params;
  const input = await body<any>(req);
  return ok(await upsertSubHead({ ...input, id: subId }));
});

export const DELETE = handler(async (req, ctx: { params: Promise<{ subId: string }> }) => {
  requireOwner(await getStaff(req));
  const { subId } = await ctx.params;
  await deleteSubHead(subId);
  return ok({ deleted: true });
});
