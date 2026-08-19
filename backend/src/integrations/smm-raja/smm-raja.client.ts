import {
  ProviderResponseInvalidError,
  ProviderTemporarilyUnavailableError,
} from "../../modules/provider-catalog/provider-catalog.adapter.js";

const smmRajaEndpoint = "https://www.smmraja.com/api/v2";
const maximumResponseBytes = 5 * 1024 * 1024;

export interface SmmRajaHttpClient {
  listServices(apiKey: string): Promise<unknown>;
}

export class NativeSmmRajaClient implements SmmRajaHttpClient {
  constructor(
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  async listServices(apiKey: string): Promise<unknown> {
    const form = new URLSearchParams({ key: apiKey, action: "services" });
    let response: Response;
    try {
      response = await this.fetchImplementation(smmRajaEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ProviderTemporarilyUnavailableError();
    }
    if (!response.ok) throw new ProviderTemporarilyUnavailableError();
    let body: string;
    try {
      body = await response.text();
    } catch {
      throw new ProviderTemporarilyUnavailableError();
    }
    if (Buffer.byteLength(body, "utf8") > maximumResponseBytes) {
      throw new ProviderResponseInvalidError();
    }
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new ProviderResponseInvalidError();
    }
  }
}
