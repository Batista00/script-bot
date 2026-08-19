import type { IntegrationsService } from "../../modules/integrations/integrations.service.js";
import type { JsonObject } from "../../modules/integrations/integrations.types.js";
import {
  type CreateProviderOrderInput,
  type CreateProviderOrderResult,
  type GetProviderOrderStatusInput,
  type ProviderFulfillmentAdapter,
  ProviderFulfillmentInputError,
  ProviderFulfillmentResponseInvalidError,
  ProviderFulfillmentServiceTypeError,
  ProviderFulfillmentUnavailableError,
  ProviderOrderRejectedError,
  type ProviderOrderStatusResult,
  ProviderSubmissionUnknownError,
} from "../../modules/fulfillments/fulfillments.adapter.js";
import type { SmmRajaFulfillmentHttpClient } from "./smm-raja.client.js";

type SupportedType = "default" | "custom_comments" | "mentions_user_followers" |
  "package" | "drip_feed" | "subscriptions" | "comment_likes";

const decimalPattern = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProviderFulfillmentResponseInvalidError();
  }
  return value as Record<string, unknown>;
}

function apiKey(credentials: JsonObject): string {
  const value = credentials.apiKey;
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
    throw new ProviderFulfillmentUnavailableError();
  }
  return value;
}

function serviceType(value: string | null): SupportedType {
  if (value === null) throw new ProviderFulfillmentServiceTypeError();
  const normalized = value.trim().toLowerCase().replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
  const types: Record<string, SupportedType> = {
    default: "default",
    "custom comments": "custom_comments",
    "mentions user followers": "mentions_user_followers",
    package: "package",
    "drip feed": "drip_feed",
    subscriptions: "subscriptions",
    "comment likes": "comment_likes",
  };
  const result = types[normalized];
  if (!result) throw new ProviderFulfillmentServiceTypeError();
  return result;
}

function assertKeys(input: JsonObject, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(input).some((key) => !allowedSet.has(key))) {
    throw new ProviderFulfillmentInputError();
  }
}

function stringValue(
  input: JsonObject,
  key: string,
  maximumLength: number,
  multiline = false,
): string {
  const value = input[key];
  if (typeof value !== "string") throw new ProviderFulfillmentInputError();
  const normalized = multiline ? value.replace(/\r\n/g, "\n").trim() : value.trim();
  if (normalized.length === 0 || normalized.length > maximumLength) {
    throw new ProviderFulfillmentInputError();
  }
  return normalized;
}

function link(input: JsonObject): string {
  const value = stringValue(input, "link", 2048);
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Invalid protocol");
    }
  } catch {
    throw new ProviderFulfillmentInputError();
  }
  return value;
}

function integerValue(
  input: JsonObject,
  key: string,
  minimum: number,
  maximum = 2_147_483_647,
): string {
  const value = input[key];
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new ProviderFulfillmentInputError();
  }
  return String(value);
}

function createParameters(input: CreateProviderOrderInput): Record<string, string> {
  const type = serviceType(input.serviceType);
  const quantity = String(input.quantity);
  switch (type) {
    case "default":
      assertKeys(input.fulfillmentInput, ["link"]);
      return { link: link(input.fulfillmentInput), quantity };
    case "custom_comments":
      assertKeys(input.fulfillmentInput, ["link", "comments"]);
      return {
        link: link(input.fulfillmentInput),
        comments: stringValue(input.fulfillmentInput, "comments", 50_000, true),
      };
    case "mentions_user_followers":
    case "comment_likes":
      assertKeys(input.fulfillmentInput, ["link", "username"]);
      return {
        link: link(input.fulfillmentInput),
        username: stringValue(input.fulfillmentInput, "username", 255),
        quantity,
      };
    case "package":
      assertKeys(input.fulfillmentInput, ["link"]);
      return { link: link(input.fulfillmentInput) };
    case "drip_feed":
      assertKeys(input.fulfillmentInput, ["link", "runs", "interval"]);
      return {
        link: link(input.fulfillmentInput),
        quantity,
        runs: integerValue(input.fulfillmentInput, "runs", 1, 100_000),
        interval: integerValue(input.fulfillmentInput, "interval", 1, 525_600),
      };
    case "subscriptions": {
      const keys = ["username", "min", "max", "posts", "delay", "expiry"];
      assertKeys(input.fulfillmentInput, keys);
      const min = Number(integerValue(input.fulfillmentInput, "min", 1));
      const max = Number(integerValue(input.fulfillmentInput, "max", 1));
      if (max < min) throw new ProviderFulfillmentInputError();
      return {
        username: stringValue(input.fulfillmentInput, "username", 255),
        min: String(min),
        max: String(max),
        posts: integerValue(input.fulfillmentInput, "posts", 0, 1_000_000),
        delay: integerValue(input.fulfillmentInput, "delay", 0, 525_600),
        expiry: stringValue(input.fulfillmentInput, "expiry", 64),
      };
    }
  }
}

function providerOrderId(value: unknown, error: Error): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value !== "string") throw error;
  const normalized = value.trim();
  if (!/^[0-9]{1,128}$/.test(normalized) || /^0+$/.test(normalized)) throw error;
  return normalized.replace(/^0+(?=[0-9])/, "");
}

function statusRaw(value: unknown): string {
  if (typeof value !== "string") throw new ProviderFulfillmentResponseInvalidError();
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ");
  if (normalized.length === 0 || normalized.length > 255) {
    throw new ProviderFulfillmentResponseInvalidError();
  }
  return normalized;
}

function mappedStatus(raw: string): ProviderOrderStatusResult["status"] {
  const normalized = raw.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
  const statuses: Record<string, ProviderOrderStatusResult["status"]> = {
    pending: "submitted",
    "in progress": "in_progress",
    processing: "in_progress",
    completed: "completed",
    partial: "partial",
    canceled: "cancelled",
    cancelled: "cancelled",
  };
  return statuses[normalized] ?? null;
}

function decimalMetric(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!decimalPattern.test(normalized)) return null;
  const [integerPart = "", fractionPart] = normalized.split(".");
  const integer = integerPart.replace(/^0+(?=[0-9])/, "");
  if (integer.length > 18 || (fractionPart?.length ?? 0) > 12) return null;
  return fractionPart === undefined ? integer : `${integer}.${fractionPart}`;
}

function nonnegativeInteger(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value :
    (typeof value === "string" && /^[0-9]+$/.test(value.trim()) ? Number(value.trim()) : NaN);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 2_147_483_647 ? parsed : null;
}

function currency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

export class SmmRajaFulfillmentAdapter implements ProviderFulfillmentAdapter {
  readonly key = "smm_raja";

  constructor(
    private readonly integrations: Pick<IntegrationsService, "getActiveIntegrationById">,
    private readonly client: SmmRajaFulfillmentHttpClient,
  ) {}

  async createOrder(input: CreateProviderOrderInput): Promise<CreateProviderOrderResult> {
    const integration = await this.activeIntegration(input.businessId, input.integrationId);
    const payload = await this.client.createOrder(
      apiKey(integration.credentials),
      input.externalServiceId,
      createParameters(input),
    );
    const response = object(payload);
    if (response.error !== undefined) throw new ProviderOrderRejectedError();
    return {
      providerOrderId: providerOrderId(response.order, new ProviderSubmissionUnknownError()),
    };
  }

  async getOrderStatus(input: GetProviderOrderStatusInput): Promise<ProviderOrderStatusResult> {
    const integration = await this.activeIntegration(input.businessId, input.integrationId);
    const expectedOrderId = providerOrderId(
      input.providerOrderId,
      new ProviderFulfillmentResponseInvalidError(),
    );
    const response = object(await this.client.getOrderStatus(
      apiKey(integration.credentials),
      expectedOrderId,
    ));
    if (response.error !== undefined) throw new ProviderFulfillmentResponseInvalidError();
    const raw = statusRaw(response.status);
    return {
      providerOrderId: expectedOrderId,
      providerStatusRaw: raw,
      status: mappedStatus(raw),
      charge: decimalMetric(response.charge),
      currency: currency(response.currency),
      remains: nonnegativeInteger(response.remains),
      startCount: nonnegativeInteger(response.start_count),
    };
  }

  private async activeIntegration(businessId: string, integrationId: string) {
    const integration = await this.integrations.getActiveIntegrationById(integrationId, this.key);
    if (!integration || integration.businessId !== businessId) {
      throw new ProviderFulfillmentUnavailableError();
    }
    return integration;
  }
}
