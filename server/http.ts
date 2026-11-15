// Shared API plumbing: standard error envelope (plan §4.1), JSON body parsing.
import { ApiError } from "./db";

export function ok(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function fail(e: unknown): Response {
  if (e instanceof ApiError) {
    return ok({ error: { code: e.code, message: e.message, details: e.details ?? undefined }, requestId: crypto.randomUUID() }, e.status);
  }
  console.error("[api] unexpected error:", e);
  return ok({ error: { code: "INTERNAL", message: "Server error — dobara try karein" }, requestId: crypto.randomUUID() }, 500);
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(400, "BAD_JSON", "Request body JSON nahi hai");
  }
}

/** Wrap a route handler with the standard error envelope. */
export function handler<A extends unknown[]>(fn: (req: Request, ...args: A) => Promise<Response>) {
  return async (req: Request, ...args: A): Promise<Response> => {
    try {
      return await fn(req, ...args);
    } catch (e) {
      return fail(e);
    }
  };
}
