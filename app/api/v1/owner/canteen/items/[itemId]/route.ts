import { handler, ok, body } from "@/server/http";
import { getStaff, requireOwner } from "@/server/auth";
import { upsertMenuItem, deleteMenuItem } from "@/server/services/catalogAdmin";

export const dynamic = "force-dynamic";

export const PATCH = handler(async (req, ctx: { params: Promise<{ itemId: string }> }) => {
  const staff = requireOwner(await getStaff(req));
  const { itemId } = await ctx.params;
  const input = await body<any>(req);
  const r = await upsertMenuItem({ ...input, id: itemId }, staff);
  return ok(r);
});

export const DELETE = handler(async (req, ctx: { params: Promise<{ itemId: string }> }) => {
  requireOwner(await getStaff(req));
  const { itemId } = await ctx.params;
  await deleteMenuItem(itemId);
  return ok({ deleted: true });
});
