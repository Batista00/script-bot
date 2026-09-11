import type { EvolutionSettings } from "./evolution.settings.js";
import {
  EvolutionRequestRejectedError,
  EvolutionTemporarilyUnavailableError,
} from "./evolution.types.js";

const maximumExternalMessageIdLength = 200;

export interface EvolutionHttpClient {
  /** Sends a plain text message and returns the provider message id when present. */
  sendText(settings: EvolutionSettings, to: string, text: string): Promise<string | null>;
}

function messageIdFromBody(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const candidates: unknown[] = [];
  const key = record.key;
  if (typeof key === "object" && key !== null && !Array.isArray(key)) {
    candidates.push((key as Record<string, unknown>).id);
  }
  candidates.push(record.id, record.messageId);
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const normalized = candidate.trim();
    if (normalized.length > 0 && normalized.length <= maximumExternalMessageIdLength) {
      return normalized;
    }
  }
  return null;
}

export class NativeEvolutionClient implements EvolutionHttpClient {
  constructor(
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  async sendText(
    settings: EvolutionSettings,
    to: string,
    text: string,
  ): Promise<string | null> {
    const endpoint =
      `${settings.baseUrl}/message/sendText/${encodeURIComponent(settings.instance)}`;
    let response: Response;
    try {
      response = await this.fetchImplementation(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: settings.apiKey,
        },
        body: JSON.stringify({ number: to, text }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new EvolutionTemporarilyUnavailableError();
    }
    if (response.status === 401 || response.status === 403) {
      throw new EvolutionRequestRejectedError();
    }
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      throw new EvolutionTemporarilyUnavailableError();
    }
    if (!response.ok) throw new EvolutionRequestRejectedError();
    // A successful send with an unreadable body still succeeded: the message
    // id is only a correlation hint, never a reason to report a failure.
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return messageIdFromBody(body);
  }
}
