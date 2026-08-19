import {
  type MercadoPagoHttpClient,
  MercadoPagoApiError,
  type MercadoPagoPaymentResource,
  type MercadoPagoPreference,
  type MercadoPagoPreferenceRequest,
} from "./mercado-pago.types.js";

const apiBaseUrl = "https://api.mercadopago.com";

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MercadoPagoApiError();
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, maxLength = 255): string {
  if (typeof value !== "string") throw new MercadoPagoApiError();
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new MercadoPagoApiError();
  }
  return normalized;
}

function paymentId(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  const normalized = nonEmptyString(value, 32);
  if (!/^[0-9]+$/.test(normalized)) throw new MercadoPagoApiError();
  return normalized;
}

export class NativeMercadoPagoClient implements MercadoPagoHttpClient {
  constructor(
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  async createPreference(
    accessToken: string,
    input: MercadoPagoPreferenceRequest,
  ): Promise<MercadoPagoPreference> {
    const body = objectValue(await this.request(
      "/checkout/preferences",
      accessToken,
      { method: "POST", body: JSON.stringify(input) },
    ));
    const initPoint = nonEmptyString(body.init_point, 2048);
    const parsedUrl = new URL(initPoint);
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      throw new MercadoPagoApiError();
    }
    return { id: nonEmptyString(body.id), initPoint };
  }

  async getPayment(
    accessToken: string,
    requestedPaymentId: string,
  ): Promise<MercadoPagoPaymentResource> {
    const body = objectValue(await this.request(
      `/v1/payments/${encodeURIComponent(requestedPaymentId)}`,
      accessToken,
      { method: "GET" },
    ));
    const amount = body.transaction_amount;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      throw new MercadoPagoApiError();
    }
    const externalReference = body.external_reference;
    const statusDetail = body.status_detail;
    return {
      id: paymentId(body.id),
      status: nonEmptyString(body.status, 64),
      statusDetail: statusDetail === null || statusDetail === undefined
        ? null
        : nonEmptyString(statusDetail, 255),
      transactionAmount: amount,
      currencyId: nonEmptyString(body.currency_id, 3),
      externalReference: externalReference === null || externalReference === undefined
        ? null
        : nonEmptyString(externalReference, 255),
    };
  }

  private async request(
    path: string,
    accessToken: string,
    init: Pick<RequestInit, "method" | "body">,
  ): Promise<unknown> {
    try {
      const response = await this.fetchImplementation(`${apiBaseUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new MercadoPagoApiError();
      return await response.json();
    } catch (error) {
      if (error instanceof MercadoPagoApiError) throw error;
      throw new MercadoPagoApiError();
    }
  }
}
