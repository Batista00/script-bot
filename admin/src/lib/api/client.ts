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
  502: "El proveedor respondió de forma inesperada.",
  503: "El servicio no está disponible temporalmente.",
};

const safeCodeMessages: Record<string, string> = {
  INVALID_REQUEST: "Hay campos inválidos o incompletos. Revisa los valores del formulario.",
  INVALID_CURRENCY: "La moneda debe tener un código válido de tres letras, por ejemplo CLP.",
  INVALID_MONEY_AMOUNT: "El precio retail debe ser un número entero mayor que cero.",
  INVALID_PRODUCT_QUANTITY: "Las cantidades del producto deben ser números enteros mayores que cero.",
  INVALID_PRODUCT_QUANTITY_RANGE: "La cantidad máxima debe ser igual o mayor que la cantidad mínima.",
  INVALID_PRICE_QUANTITY: "Las cantidades del precio deben ser números enteros mayores que cero.",
  INVALID_PRICE_QUANTITY_RANGE: "La cantidad máxima del precio debe ser igual o mayor que la mínima.",
  INVALID_PRODUCT_SKU: "El SKU solo puede usar letras, números, punto, guion y guion bajo.",
  PRODUCT_SKU_CONFLICT: "Ya existe un producto con ese SKU en este negocio.",
  BUSINESS_CURRENCY_MISMATCH: "La moneda retail debe coincidir con la moneda global del negocio.",
  PROVIDER_REQUEST_REJECTED: "El proveedor rechazó la solicitud. Revisa que la API key esté vigente y tenga acceso al catálogo.",
  PROVIDER_RESPONSE_INVALID: "El proveedor devolvió un formato no reconocido. Intenta sincronizar más tarde.",
  PROVIDER_CATALOG_NOT_AVAILABLE: "La integración no tiene credenciales válidas para consultar el catálogo.",
  PROVIDER_TEMPORARILY_UNAVAILABLE: "El proveedor no está disponible temporalmente. Intenta nuevamente.",
  PRODUCT_HAS_COMMERCIAL_HISTORY: "El producto tiene historial comercial y no puede eliminarse. Desactívalo para conservar la trazabilidad.",
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
    const message = safeCodeMessages[code] ?? (response.status === 409 && payload.error?.message
      ? payload.error.message
      : (safeMessages[response.status] ?? "No fue posible completar la solicitud."));
    if (response.status === 401) window.dispatchEvent(new Event(unauthorizedEvent));
    throw new ApiError(response.status, code, message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "No fue posible completar la solicitud.";
}
