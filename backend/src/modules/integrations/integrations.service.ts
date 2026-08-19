import { AppError } from "../../core/errors/app-error.js";
import { IntegrationCredentialsCrypto } from "./integrations.crypto.js";
import {
  type ActiveIntegration,
  type BusinessIntegration,
  type BusinessIntegrationRecord,
  type CreateIntegrationInput,
  type IntegrationListOptions,
  IntegrationProviderConflictError,
  type IntegrationsRepository,
  type JsonObject,
  type JsonValue,
  type UpdateIntegrationInput,
} from "./integrations.types.js";

const providerKeyPattern = /^[a-z0-9][a-z0-9_]{0,63}$/;
const secretKeyPattern = /(secret|token|password|credential|authorization|api_?key|private_?key)/i;

function normalizeProviderKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!providerKeyPattern.test(normalized)) {
    throw new AppError("Invalid integration provider key", 400, "INVALID_PROVIDER_KEY");
  }
  return normalized;
}

function containsSecretKey(value: JsonValue): boolean {
  if (Array.isArray(value)) return value.some(containsSecretKey);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(([key, nested]) =>
    secretKeyPattern.test(key) || containsSecretKey(nested));
}

function validateConfig(config: JsonObject): void {
  if (containsSecretKey(config)) {
    throw new AppError(
      "Integration config cannot contain credentials",
      400,
      "INTEGRATION_CONFIG_CONTAINS_SECRET",
    );
  }
}

function validateCredentials(credentials: JsonObject): void {
  if (Object.keys(credentials).length === 0) {
    throw new AppError(
      "Integration credentials are required",
      400,
      "INTEGRATION_CREDENTIALS_REQUIRED",
    );
  }
}

function toPublic(record: BusinessIntegrationRecord): BusinessIntegration {
  return {
    id: record.id,
    businessId: record.businessId,
    providerKey: record.providerKey,
    status: record.status,
    config: record.config,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function conflictError(): AppError {
  return new AppError(
    "Integration provider already exists for this business",
    409,
    "INTEGRATION_PROVIDER_ALREADY_EXISTS",
  );
}

export class IntegrationsService {
  constructor(
    private readonly repository: IntegrationsRepository,
    private readonly crypto: IntegrationCredentialsCrypto,
  ) {}

  async create(
    businessId: string,
    input: CreateIntegrationInput,
  ): Promise<BusinessIntegration> {
    const providerKey = normalizeProviderKey(input.providerKey);
    const config = input.config ?? {};
    validateConfig(config);
    validateCredentials(input.credentials);
    const credentialsEncrypted = this.crypto.encrypt(
      input.credentials,
      businessId,
      providerKey,
    );
    try {
      return toPublic(await this.repository.create(businessId, {
        providerKey,
        status: "active",
        config,
        credentialsEncrypted,
      }));
    } catch (error) {
      if (error instanceof IntegrationProviderConflictError) throw conflictError();
      throw error;
    }
  }

  async list(
    businessId: string,
    options: IntegrationListOptions,
  ): Promise<BusinessIntegration[]> {
    let providerKey: string | undefined;
    if (options.providerKey !== undefined) {
      providerKey = normalizeProviderKey(options.providerKey);
    }
    const records = await this.repository.list(businessId, {
      ...options,
      ...(providerKey === undefined ? {} : { providerKey }),
    });
    return records.map(toPublic);
  }

  async getById(businessId: string, integrationId: string): Promise<BusinessIntegration> {
    const record = await this.repository.findById(businessId, integrationId);
    if (!record) throw new AppError("Integration not found", 404, "INTEGRATION_NOT_FOUND");
    return toPublic(record);
  }

  async update(
    businessId: string,
    integrationId: string,
    input: UpdateIntegrationInput,
  ): Promise<BusinessIntegration> {
    const existing = await this.repository.findById(businessId, integrationId);
    if (!existing) throw new AppError("Integration not found", 404, "INTEGRATION_NOT_FOUND");
    const config = input.config ?? existing.config;
    if (input.config !== undefined) validateConfig(input.config);
    let credentialsEncrypted = existing.credentialsEncrypted;
    if (input.credentials !== undefined) {
      validateCredentials(input.credentials);
      credentialsEncrypted = this.crypto.encrypt(
        input.credentials,
        businessId,
        existing.providerKey,
      );
    }
    try {
      const updated = await this.repository.update(businessId, integrationId, {
        providerKey: existing.providerKey,
        status: input.status ?? existing.status,
        config,
        credentialsEncrypted,
      });
      if (!updated) throw new AppError("Integration not found", 404, "INTEGRATION_NOT_FOUND");
      return toPublic(updated);
    } catch (error) {
      if (error instanceof IntegrationProviderConflictError) throw conflictError();
      throw error;
    }
  }

  async getActiveIntegration(
    businessId: string,
    providerKeyInput: string,
  ): Promise<ActiveIntegration | null> {
    const providerKey = normalizeProviderKey(providerKeyInput);
    const record = await this.repository.findByProviderKey(businessId, providerKey);
    if (!record || record.status !== "active") return null;
    return {
      id: record.id,
      businessId: record.businessId,
      providerKey: record.providerKey,
      config: record.config,
      credentials: this.crypto.decrypt(
        record.credentialsEncrypted,
        record.businessId,
        record.providerKey,
      ),
    };
  }

  async getActiveIntegrationById(
    integrationId: string,
    requiredProviderKey: string,
  ): Promise<ActiveIntegration | null> {
    const providerKey = normalizeProviderKey(requiredProviderKey);
    const record = await this.repository.findInternalById(integrationId);
    if (
      !record || record.status !== "active" || record.providerKey !== providerKey
    ) {
      return null;
    }
    return {
      id: record.id,
      businessId: record.businessId,
      providerKey: record.providerKey,
      config: record.config,
      credentials: this.crypto.decrypt(
        record.credentialsEncrypted,
        record.businessId,
        record.providerKey,
      ),
    };
  }
}
