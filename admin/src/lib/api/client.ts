import type { QueryValue } from "./types";

const configuredBase = import.meta.env.VITE_API_BASE_PATH as string | undefined;
export const apiBasePath = configuredBase?.replace(/\/$/, "") || "/api";
export const unauthorizedEvent = "bot-whatsap:unauthorized";

const safeMessages: Record<number, string> = {
  400: "Revisa los datos enviados.",
  401: "Tu sesión ya no es válida.",
  403: "No tienes permisos para realizar esta acción.",
  404: "No se encontró el recurso solicitado.",
  409: "La operación entra en conflicto con el estado actual.",
  422: "No fue posible validar los datos.",
  500: "Ocurrió un error interno. Intenta nuevamente.",
  503: "El servicio no está disponible temporalmente.",
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) { super(message); this.name = "ApiError"; }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  query?: Record<string, QueryValue>;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`${apiBasePath}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(url.pathname + url.search, {
    ...options,
    headers,
    credentials: "same-origin",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    let payload: { error?: { code?: string; message?: string } } = {};
    try { payload = await response.json() as typeof payload; } catch { /* safe fallback */ }
    const code = payload.error?.code ?? `HTTP_${response.status}`;
    const message = response.status === 409 && payload.error?.message
      ? payload.error.message
      : (safeMessages[response.status] ?? "No fue posible completar la solicitud.");
    if (response.status === 401) window.dispatchEvent(new Event(unauthorizedEvent));
    throw new ApiError(response.status, code, message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "No fue posible completar la solicitud.";
}
