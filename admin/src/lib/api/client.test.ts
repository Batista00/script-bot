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
  [429, "Demasiados intentos de inicio de sesión. Espera unos minutos y vuelve a intentarlo."],
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

test("explains login rate limiting from the 429 domain code", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
    error: { code: "TOO_MANY_LOGIN_ATTEMPTS", message: "Too many login attempts. Try again later." },
  }), { status: 429, headers: { "content-type": "application/json", "retry-after": "60" } }));
  await expect(apiRequest("/test")).rejects.toMatchObject({
    status: 429,
    code: "TOO_MANY_LOGIN_ATTEMPTS",
    message: "Demasiados intentos de inicio de sesión. Espera unos minutos y vuelve a intentarlo.",
  } satisfies Partial<ApiError>);
});

const domainCodeCases: Array<[string, number, string]> = [
  ["BUSINESS_INACTIVE", 409, "El negocio está inactivo y no admite operaciones comerciales. Reactívalo desde Configuración para continuar."],
  ["MEMBERSHIP_ROLE_NOT_ALLOWED", 403, "Solo un owner puede gestionar a otros owners o conceder ese rol."],
  ["MEMBERSHIP_SELF_MODIFICATION", 409, "No puedes modificar tu propia membresía."],
  ["LAST_OWNER_REQUIRED", 409, "El negocio debe conservar al menos un owner activo."],
  ["MEMBERSHIP_ALREADY_EXISTS", 409, "Ese usuario ya pertenece al negocio. Reactiva su membresía en lugar de crearla de nuevo."],
  ["USER_INACTIVE", 409, "La cuenta de ese correo está inactiva y no puede recibir acceso."],
  ["USER_EMAIL_ALREADY_EXISTS", 409, "Ya existe una cuenta registrada con ese correo."],
  ["USER_DETAILS_REQUIRED", 400, "Indica nombre y contraseña para crear la cuenta nueva."],
  ["INVALID_USER_PASSWORD", 400, "La contraseña debe tener entre 12 y 128 caracteres."],
  ["QUOTE_ALREADY_CONVERTED", 409, "Esta cotización ya fue convertida en pedido."],
  ["QUOTE_EXPIRED", 409, "La cotización expiró. Crea una nueva para continuar."],
  ["QUOTE_NOT_AVAILABLE", 404, "La cotización no está disponible para convertirse en pedido."],
  ["CUSTOMER_REQUIRED", 400, "Asigna un cliente a la cotización antes de convertirla en pedido."],
];

test.each(domainCodeCases)("maps %s to an actionable message without leaking internals", async (code, status, expected) => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
    error: { code, message: "internal backend detail" },
  }), { status, headers: { "content-type": "application/json" } }));
  await expect(apiRequest("/test")).rejects.toMatchObject({ status, code, message: expected } satisfies Partial<ApiError>);
});
