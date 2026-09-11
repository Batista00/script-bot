import type { IntegrationsService } from "../../modules/integrations/integrations.service.js";
import type {
  JsonObject,
  JsonValue,
} from "../../modules/integrations/integrations.types.js";
import {
  ProviderCatalogUnavailableError,
  type ProviderCatalogAdapter,
  ProviderRequestRejectedError,
  ProviderResponseInvalidError,
} from "../../modules/provider-catalog/provider-catalog.adapter.js";
import type { NormalizedProviderService } from "../../modules/provider-catalog/provider-catalog.types.js";
import type {
  ProviderBalance,
  ProviderCatalogFetchResult,
  ProviderOrderCapabilities,
  ProviderOrderField,
} from "../../modules/provider-catalog/provider-catalog.types.js";
import type { SmmRajaHttpClient } from "./smm-raja.client.js";

const knownServiceKeys = new Set([
  "service", "name", "category", "type", "rate", "min", "max", "description",
  "refill", "cancel",
]);
const secretKeyPattern = /(secret|token|password|credential|authorization|api_?key|private_?key|^key$)/i;
const decimalPattern = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProviderResponseInvalidError();
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, maximumLength: number): string {
  if (typeof value !== "string") throw new ProviderResponseInvalidError();
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximumLength) {
    throw new ProviderResponseInvalidError();
  }
  return normalized;
}

function optionalString(value: unknown, maximumLength: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredString(value, maximumLength);
}

function externalServiceId(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  const normalized = requiredString(value, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(normalized) || /^0+$/.test(normalized)) {
    throw new ProviderResponseInvalidError();
  }
  return normalized;
}

function decimalRate(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const normalized = requiredString(value, 64);
  if (!decimalPattern.test(normalized)) throw new ProviderResponseInvalidError();
  const [integerPart = "", fractionPart] = normalized.split(".");
  const integer = integerPart.replace(/^0+(?=[0-9])/, "");
  if (integer.length > 18 || (fractionPart?.length ?? 0) > 12) {
    throw new ProviderResponseInvalidError();
  }
  if (!/[1-9]/.test(`${integer}${fractionPart ?? ""}`)) return null;
  return fractionPart === undefined ? integer : `${integer}.${fractionPart}`;
}

function nonnegativeDecimal(value: unknown): string {
  if (typeof value !== "string") throw new ProviderResponseInvalidError();
  const normalized = value.trim();
  if (!decimalPattern.test(normalized)) throw new ProviderResponseInvalidError();
  const [integerPart = "", fractionPart] = normalized.split(".");
  const integer = integerPart.replace(/^0+(?=[0-9])/, "");
  if (integer.length > 18 || (fractionPart?.length ?? 0) > 12) {
    throw new ProviderResponseInvalidError();
  }
  return fractionPart === undefined ? integer : `${integer}.${fractionPart}`;
}

function optionalBoolean(value: unknown): boolean | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return null;
}

function optionalPositiveInteger(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string" && /^[0-9]+$/.test(value.trim())) {
    parsed = Number(value.trim());
  } else {
    throw new ProviderResponseInvalidError();
  }
  if (parsed === 0) return null;
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 2_147_483_647) {
    throw new ProviderResponseInvalidError();
  }
  return parsed;
}

function safeJsonValue(value: unknown, depth = 0): JsonValue | undefined {
  if (depth > 5) return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const values = value.slice(0, 100).map((item) => safeJsonValue(item, depth + 1))
      .filter((item): item is JsonValue => item !== undefined);
    return values;
  }
  if (typeof value !== "object") return undefined;
  const result: JsonObject = {};
  for (const [key, nested] of Object.entries(value).slice(0, 100)) {
    if (secretKeyPattern.test(key)) continue;
    const safeValue = safeJsonValue(nested, depth + 1);
    if (safeValue !== undefined) result[key] = safeValue;
  }
  return result;
}

function metadata(service: Record<string, unknown>): JsonObject {
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(service)) {
    if (knownServiceKeys.has(key) || secretKeyPattern.test(key)) continue;
    const safeValue = safeJsonValue(value);
    if (safeValue !== undefined) result[key] = safeValue;
  }
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 65_535) {
    throw new ProviderResponseInvalidError();
  }
  return result;
}

const field = (
  key: string,
  providerField: string,
  type: ProviderOrderField["type"],
): ProviderOrderField => ({ key, providerField, type });

export function smmRajaOrderCapabilities(serviceType: string | null): ProviderOrderCapabilities {
  const type = serviceType?.trim().toLowerCase().replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ") ?? "";
  const targetUrl = field("targetUrl", "link", "url");
  const username = field("username", "username", "text");
  const official: Record<string, ProviderOrderField[]> = {
    default: [targetUrl],
    "custom comments": [targetUrl, field("comments", "comments", "textarea")],
    "mentions user followers": [targetUrl, username],
    package: [targetUrl],
    "drip feed": [targetUrl, field("runs", "runs", "integer"), field("interval", "interval", "integer")],
    subscriptions: [
      username,
      field("minimum", "min", "integer"),
      field("maximum", "max", "integer"),
      field("posts", "posts", "integer"),
      field("delay", "delay", "integer"),
      field("expiry", "expiry", "date"),
    ],
    "comment likes": [targetUrl, username],
  };
  const required = official[type];
  if (required) return { supported: true, required, optional: [], source: "official" };
  return {
    supported: false,
    required: [],
    optional: [],
    source: "unverified",
    unsupportedReason: "Provider order contract is not documented",
  };
}

function normalizeService(item: unknown): NormalizedProviderService {
  const service = record(item);
  const minQuantity = optionalPositiveInteger(service.min);
  const maxQuantity = optionalPositiveInteger(service.max);
  if (minQuantity !== null && maxQuantity !== null && maxQuantity < minQuantity) {
    throw new ProviderResponseInvalidError();
  }
  const serviceType = optionalString(service.type, 255);
  return {
    externalServiceId: externalServiceId(service.service),
    name: requiredString(service.name, 500),
    category: optionalString(service.category, 255),
    serviceType,
    rate: decimalRate(service.rate),
    rateCurrency: "USD",
    minQuantity,
    maxQuantity,
    providerDescription: optionalString(service.description, 5000),
    supportsRefill: optionalBoolean(service.refill),
    supportsCancel: optionalBoolean(service.cancel),
    orderCapabilities: smmRajaOrderCapabilities(serviceType),
    metadata: metadata(service),
  };
}

export function normalizeSmmRajaCatalog(payload: unknown): ProviderCatalogFetchResult {
  if (!Array.isArray(payload)) {
    if (
      typeof payload === "object" && payload !== null &&
      typeof (payload as Record<string, unknown>).error === "string"
    ) {
      throw new ProviderRequestRejectedError();
    }
    throw new ProviderResponseInvalidError();
  }
  const unique = new Map<string, NormalizedProviderService>();
  const rejectionReasons: Record<string, number> = {};
  const reject = (reason: string) => {
    rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
  };
  for (const item of payload) {
    try {
      const service = normalizeService(item);
      if (unique.has(service.externalServiceId)) {
        reject("duplicate_external_service_id");
      } else {
        unique.set(service.externalServiceId, service);
      }
    } catch (error) {
      if (!(error instanceof ProviderResponseInvalidError)) throw error;
      reject("invalid_service_record");
    }
  }
  const services = [...unique.values()];
  return {
    services,
    received: payload.length,
    rejected: payload.length - services.length,
    rejectionReasons,
  };
}

export function normalizeSmmRajaServices(payload: unknown): NormalizedProviderService[] {
  return [...normalizeSmmRajaCatalog(payload).services];
}

export function normalizeSmmRajaBalance(payload: unknown): ProviderBalance {
  const response = record(payload);
  if (typeof response.error === "string") throw new ProviderRequestRejectedError();
  const rawBalance = nonnegativeDecimal(response.balance);
  const currency = optionalString(response.currency, 3)?.toUpperCase() ?? null;
  if (currency === null || !/^[A-Z]{3}$/.test(currency)) {
    throw new ProviderResponseInvalidError();
  }
  return { balance: rawBalance, currency };
}

export class SmmRajaCatalogAdapter implements ProviderCatalogAdapter {
  readonly key = "smm_raja";

  constructor(
    private readonly integrations: Pick<IntegrationsService, "getActiveIntegration">,
    private readonly client: SmmRajaHttpClient,
  ) {}

  async listServices(businessId: string): Promise<ProviderCatalogFetchResult> {
    const apiKey = await this.apiKey(businessId);
    return normalizeSmmRajaCatalog(await this.client.listServices(apiKey));
  }

  async getBalance(businessId: string): Promise<ProviderBalance> {
    const apiKey = await this.apiKey(businessId);
    return normalizeSmmRajaBalance(await this.client.getBalance(apiKey));
  }

  private async apiKey(businessId: string): Promise<string> {
    const integration = await this.integrations.getActiveIntegration(businessId, this.key);
    const apiKey = integration?.credentials.apiKey;
    if (typeof apiKey !== "string" || apiKey.length === 0 || apiKey.length > 4096) {
      throw new ProviderCatalogUnavailableError();
    }
    return apiKey;
  }
}
