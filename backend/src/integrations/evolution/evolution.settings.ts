import type { ActiveIntegration } from "../../modules/integrations/integrations.types.js";

export class EvolutionSettingsError extends Error {
  constructor() {
    super("Evolution integration is not configured correctly");
    this.name = "EvolutionSettingsError";
  }
}

export interface EvolutionSettings {
  /** Base URL without a trailing slash, for example `https://evo.example.com`. */
  baseUrl: string;
  /** Evolution instance name; path-safe characters only. */
  instance: string;
  apiKey: string;
}

const instancePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const maximumBaseUrlLength = 2048;
const maximumApiKeyLength = 4096;

function requiredString(
  source: Record<string, unknown>,
  key: string,
  maximumLength: number,
): string {
  const value = source[key];
  if (typeof value !== "string") throw new EvolutionSettingsError();
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximumLength) {
    throw new EvolutionSettingsError();
  }
  return normalized;
}

function normalizedBaseUrl(value: string, nodeEnv: "development" | "test" | "production"): string {
  const withoutTrailingSlash = value.replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(withoutTrailingSlash);
  } catch {
    throw new EvolutionSettingsError();
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new EvolutionSettingsError();
  }
  // Plain HTTP is only tolerated inside the test suite; production and
  // development must talk to Evolution over TLS.
  if (nodeEnv !== "test" && parsed.protocol !== "https:") {
    throw new EvolutionSettingsError();
  }
  if (
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new EvolutionSettingsError();
  }
  return withoutTrailingSlash;
}

/**
 * Reads the non-secret `config` and the encrypted `credentials` of an
 * Evolution integration. Throws `EvolutionSettingsError` when a required value
 * is missing or malformed; the adapter turns that into a controlled failure.
 */
export function evolutionSettings(
  integration: ActiveIntegration,
  nodeEnv: "development" | "test" | "production",
): EvolutionSettings {
  const instance = requiredString(integration.config, "instance", 128);
  if (!instancePattern.test(instance)) throw new EvolutionSettingsError();
  const apiKey = requiredString(integration.credentials, "apiKey", maximumApiKeyLength);
  return {
    baseUrl: normalizedBaseUrl(
      requiredString(integration.config, "baseUrl", maximumBaseUrlLength),
      nodeEnv,
    ),
    instance,
    apiKey,
  };
}
