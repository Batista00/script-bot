import { authApi } from "./resources";
import { ApiError, apiRequest } from "./client";

test("login uses the same-origin /api client with cookies", async () => {
  const payload = { user: { id: "u" }, businesses: [] };
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }));
  await expect(authApi.login("owner@example.com", "secret-value")).resolves.toEqual(payload);
  expect(fetchMock).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({ method: "POST", credentials: "same-origin", body: JSON.stringify({ email: "owner@example.com", password: "secret-value" }) }));
  expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
});

test.each([
  [400, "Revisa los datos enviados."], [401, "Tu sesión ya no es válida."],
  [403, "No tienes permisos para realizar esta acción."], [404, "No se encontró el recurso solicitado."],
  [409, "Duplicado seguro"], [422, "No fue posible validar los datos."],
  [500, "Ocurrió un error interno. Intenta nuevamente."], [502, "El proveedor respondió de forma inesperada."],
  [503, "El servicio no está disponible temporalmente."],
])("maps API status %s to a safe message", async (status, expected) => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { code: "TEST_CODE", message: "Duplicado seguro" } }), { status, headers: { "content-type": "application/json" } }));
  await expect(apiRequest("/test")).rejects.toMatchObject({ status, code: "TEST_CODE", message: expected } satisfies Partial<ApiError>);
});

test("maps provider failures to actionable messages without exposing backend details", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
    error: { code: "PROVIDER_REQUEST_REJECTED", message: "private provider response" },
  }), { status: 502, headers: { "content-type": "application/json" } }));
  await expect(apiRequest("/test")).rejects.toMatchObject({
    status: 502,
    code: "PROVIDER_REQUEST_REJECTED",
    message: "El proveedor rechazó la solicitud. Revisa que la API key esté vigente y tenga acceso al catálogo.",
  } satisfies Partial<ApiError>);
});

test("maps import validation codes to an actionable field message", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
    error: { code: "INVALID_CURRENCY", message: "internal validation detail" },
  }), { status: 400, headers: { "content-type": "application/json" } }));
  await expect(apiRequest("/test")).rejects.toMatchObject({
    status: 400,
    code: "INVALID_CURRENCY",
    message: "La moneda debe tener un código válido de tres letras, por ejemplo CLP.",
  } satisfies Partial<ApiError>);
});
