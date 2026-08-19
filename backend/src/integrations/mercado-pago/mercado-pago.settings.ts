import type { ActiveIntegration, JsonObject } from "../../modules/integrations/integrations.types.js";
import { PaymentProviderUnavailableError } from "../../modules/payments/payments.provider.js";

export interface MercadoPagoCredentials {
  accessToken: string;
  webhookSecret: string;
}

export interface MercadoPagoConfig {
  successUrl?: string;
  pendingUrl?: string;
  failureUrl?: string;
}

function requiredSecret(credentials: JsonObject, key: string): string {
  const value = credentials[key];
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
    throw new PaymentProviderUnavailableError();
  }
  return value;
}

function optionalUrl(config: JsonObject, key: string): string | undefined {
  const value = config[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    throw new PaymentProviderUnavailableError();
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Invalid protocol");
    }
    return parsed.toString();
  } catch {
    throw new PaymentProviderUnavailableError();
  }
}

export function mercadoPagoCredentials(integration: ActiveIntegration): MercadoPagoCredentials {
  return {
    accessToken: requiredSecret(integration.credentials, "accessToken"),
    webhookSecret: requiredSecret(integration.credentials, "webhookSecret"),
  };
}

export function mercadoPagoConfig(integration: ActiveIntegration): MercadoPagoConfig {
  const successUrl = optionalUrl(integration.config, "successUrl");
  const pendingUrl = optionalUrl(integration.config, "pendingUrl");
  const failureUrl = optionalUrl(integration.config, "failureUrl");
  return {
    ...(successUrl === undefined ? {} : { successUrl }),
    ...(pendingUrl === undefined ? {} : { pendingUrl }),
    ...(failureUrl === undefined ? {} : { failureUrl }),
  };
}

export function mercadoPagoNotificationUrl(
  publicApiBaseUrl: string | undefined,
  integrationId: string,
  nodeEnv: "development" | "test" | "production",
): string {
  if (publicApiBaseUrl === undefined) throw new PaymentProviderUnavailableError();
  try {
    const base = new URL(publicApiBaseUrl);
    if (nodeEnv !== "test" && base.protocol !== "https:") {
      throw new Error("HTTPS is required");
    }
    if (base.protocol !== "https:" && base.protocol !== "http:") {
      throw new Error("Invalid protocol");
    }
    base.search = "";
    base.hash = "";
    if (!base.pathname.endsWith("/")) base.pathname += "/";
    return new URL(`webhooks/mercado-pago/${integrationId}`, base).toString();
  } catch {
    throw new PaymentProviderUnavailableError();
  }
}
