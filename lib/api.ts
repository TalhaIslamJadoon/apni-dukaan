// Typed fetch client for /api/v1 (plan §5.1). Decodes the standard error
// envelope; throws ApiClientError with the server code/message.
export class ApiClientError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (data as any)?.error ?? {};
    throw new ApiClientError(res.status, e.code ?? "HTTP_ERROR", e.message ?? `Request failed (${res.status})`, e.details);
  }
  return data as T;
}

export const apiGet = <T = any>(path: string) => api<T>(path, { method: "GET" });
export const apiPost = <T = any>(path: string, bodyData?: unknown) =>
  api<T>(path, { method: "POST", body: bodyData !== undefined ? JSON.stringify(bodyData) : undefined });
export const apiPatch = <T = any>(path: string, bodyData?: unknown) =>
  api<T>(path, { method: "PATCH", body: bodyData !== undefined ? JSON.stringify(bodyData) : undefined });
export const apiPut = <T = any>(path: string, bodyData?: unknown) =>
  api<T>(path, { method: "PUT", body: bodyData !== undefined ? JSON.stringify(bodyData) : undefined });
export const apiDelete = <T = any>(path: string) => api<T>(path, { method: "DELETE" });
