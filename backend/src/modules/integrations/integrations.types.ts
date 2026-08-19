export const integrationStatuses = ["active", "inactive"] as const;

export type IntegrationStatus = (typeof integrationStatuses)[number];
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue }

export interface BusinessIntegration {
  id: string;
  businessId: string;
  providerKey: string;
  status: IntegrationStatus;
  config: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessIntegrationRecord extends BusinessIntegration {
  credentialsEncrypted: string;
}

export interface CreateIntegrationInput {
  providerKey: string;
  config?: JsonObject;
  credentials: JsonObject;
}

export interface UpdateIntegrationInput {
  status?: IntegrationStatus;
  config?: JsonObject;
  credentials?: JsonObject;
}

export interface IntegrationListOptions {
  limit: number;
  offset: number;
  status?: IntegrationStatus;
  providerKey?: string;
}

export interface IntegrationListQuery {
  limit?: string;
  offset?: string;
  status?: IntegrationStatus;
  providerKey?: string;
}

export interface IntegrationPersistenceInput {
  providerKey: string;
  status: IntegrationStatus;
  config: JsonObject;
  credentialsEncrypted: string;
}

export interface ActiveIntegration {
  id: string;
  businessId: string;
  providerKey: string;
  config: JsonObject;
  credentials: JsonObject;
}

export class IntegrationProviderConflictError extends Error {}

export interface IntegrationsRepository {
  create(
    businessId: string,
    input: IntegrationPersistenceInput,
  ): Promise<BusinessIntegrationRecord>;
  list(
    businessId: string,
    options: IntegrationListOptions,
  ): Promise<BusinessIntegrationRecord[]>;
  findById(
    businessId: string,
    integrationId: string,
  ): Promise<BusinessIntegrationRecord | null>;
  findByProviderKey(
    businessId: string,
    providerKey: string,
  ): Promise<BusinessIntegrationRecord | null>;
  findInternalById(integrationId: string): Promise<BusinessIntegrationRecord | null>;
  update(
    businessId: string,
    integrationId: string,
    input: IntegrationPersistenceInput,
  ): Promise<BusinessIntegrationRecord | null>;
}
