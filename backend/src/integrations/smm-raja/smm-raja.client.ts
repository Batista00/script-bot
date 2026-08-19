import {
  ProviderFulfillmentInputError,
  ProviderFulfillmentResponseInvalidError,
  ProviderFulfillmentTemporarilyUnavailableError,
  ProviderSubmissionUnknownError,
} from "../../modules/fulfillments/fulfillments.adapter.js";
import {
  ProviderResponseInvalidError,
  ProviderTemporarilyUnavailableError,
} from "../../modules/provider-catalog/provider-catalog.adapter.js";

const smmRajaEndpoint = "https://www.smmraja.com/api/v2";
const maximumResponseBytes = 5 * 1024 * 1024;
const reservedCreateKeys = new Set(["key", "action", "service"]);

export interface SmmRajaHttpClient {
  listServices(apiKey: string): Promise<unknown>;
}

export interface SmmRajaFulfillmentHttpClient {
  createOrder(
    apiKey: string,
    externalServiceId: string,
    parameters: Readonly<Record<string, string>>,
  ): Promise<unknown>;
  getOrderStatus(apiKey: string, providerOrderId: string): Promise<unknown>;
}

export class NativeSmmRajaClient implements SmmRajaHttpClient {
  constructor(
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  async listServices(apiKey: string): Promise<unknown> {
    const form = new URLSearchParams({ key: apiKey, action: "services" });
    const body = await this.post(form, () => new ProviderTemporarilyUnavailableError());
    return this.parse(body, () => new ProviderResponseInvalidError());
  }

  async createOrder(
    apiKey: string,
    externalServiceId: string,
    parameters: Readonly<Record<string, string>>,
  ): Promise<unknown> {
    const form = new URLSearchParams({
      key: apiKey,
      action: "add",
      service: externalServiceId,
    });
    for (const [key, value] of Object.entries(parameters)) {
      if (reservedCreateKeys.has(key)) throw new ProviderFulfillmentInputError();
      form.set(key, value);
    }
    const body = await this.post(form, () => new ProviderSubmissionUnknownError());
    return this.parse(body, () => new ProviderSubmissionUnknownError());
  }

  async getOrderStatus(apiKey: string, providerOrderId: string): Promise<unknown> {
    const form = new URLSearchParams({
      key: apiKey,
      action: "status",
      order: providerOrderId,
    });
    const body = await this.post(
      form,
      () => new ProviderFulfillmentTemporarilyUnavailableError(),
    );
    return this.parse(body, () => new ProviderFulfillmentResponseInvalidError());
  }

  private async post(form: URLSearchParams, failure: () => Error): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImplementation(smmRajaEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw failure();
    }
    if (!response.ok) throw failure();
    let body: string;
    try {
      body = await response.text();
    } catch {
      throw failure();
    }
    if (Buffer.byteLength(body, "utf8") > maximumResponseBytes) throw failure();
    return body;
  }

  private parse(body: string, failure: () => Error): unknown {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw failure();
    }
  }
}
