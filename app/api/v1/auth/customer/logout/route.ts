import { handler, ok } from "@/server/http";
import { revokeSession } from "@/server/auth";

export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  const cookie = await revokeSession(req, "customer");
  return ok({ loggedOut: true }, 200, { "set-cookie": cookie });
});
