import type { IntegrationsService } from "../../modules/integrations/integrations.service.js";
import type {
  JsonObject,
  JsonValue,
} from "../../modules/integrations/integrations.types.js";
import {
  ProviderCatalogUnavailableError,
  type ProviderCatalogAdapter,
  ProviderResponseInvalidError,
} from "../../modules/provider-catalog/provider-catalog.adapter.js";
import type { NormalizedProviderService } from "../../modules/provider-catalog/provider-catalog.types.js";
import type { SmmRajaHttpClient } from "./smm-raja.client.js";

const knownServiceKeys = new Set(["service", "name", "category", "type", "rate", "min", "max"]);
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
  if (!/^[0-9]+$/.test(normalized) || /^0+$/.test(normalized)) {
    throw new ProviderResponseInvalidError();
  }
  return normalized.replace(/^0+(?=[0-9])/, "");
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
  if (!/[1-9]/.test(`${integer}${fractionPart ?? ""}`)) {
    throw new ProviderResponseInvalidError();
  }
  return fractionPart === undefined ? integer : `${integer}.${fractionPart}`;
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
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 2_147_483_647) {
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

export function normalizeSmmRajaServices(payload: unknown): NormalizedProviderService[] {
  if (!Array.isArray(payload)) throw new ProviderResponseInvalidError();
  return payload.map((item) => {
    const service = record(item);
    const minQuantity = optionalPositiveInteger(service.min);
    const maxQuantity = optionalPositiveInteger(service.max);
    if (minQuantity !== null && maxQuantity !== null && maxQuantity < minQuantity) {
      throw new ProviderResponseInvalidError();
    }
    return {
      externalServiceId: externalServiceId(service.service),
      name: requiredString(service.name, 500),
      category: optionalString(service.category, 255),
      serviceType: optionalString(service.type, 255),
      rate: decimalRate(service.rate),
      rateCurrency: null,
      minQuantity,
      maxQuantity,
      metadata: metadata(service),
    };
  });
}

export class SmmRajaCatalogAdapter implements ProviderCatalogAdapter {
  readonly key = "smm_raja";

  constructor(
    private readonly integrations: Pick<IntegrationsService, "getActiveIntegration">,
    private readonly client: SmmRajaHttpClient,
  ) {}

  async listServices(businessId: string): Promise<readonly NormalizedProviderService[]> {
    const integration = await this.integrations.getActiveIntegration(businessId, this.key);
    const apiKey = integration?.credentials.apiKey;
    if (typeof apiKey !== "string" || apiKey.length === 0 || apiKey.length > 4096) {
      throw new ProviderCatalogUnavailableError();
    }
    return normalizeSmmRajaServices(await this.client.listServices(apiKey));
  }
}
