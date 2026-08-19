import { randomUUID } from "node:crypto";

import type {
  ApiCredential,
  ApiCredentialsRepository,
  ApiCredentialStatus,
  ApiCredentialWithHash,
} from "../../src/modules/api-credentials/api-credentials.types.js";

export const credentialNow = "2026-08-19T12:00:00.000Z";

interface StoredCredential extends ApiCredential { tokenHash: string }

export class MemoryApiCredentialsRepository implements ApiCredentialsRepository {
  readonly credentials: StoredCredential[] = [];

  async create(
    businessId: string,
    input: { name: string; tokenHash: string; prefix: string },
  ): Promise<ApiCredential> {
    const value: StoredCredential = {
      id: randomUUID(), businessId, name: input.name, prefix: input.prefix,
      tokenHash: input.tokenHash, status: "active",
      createdAt: credentialNow, updatedAt: credentialNow,
    };
    this.credentials.push(value);
    return this.public(value);
  }
  async list(businessId: string): Promise<ApiCredential[]> {
    return this.credentials.filter((value) => value.businessId === businessId).map(this.public);
  }
  async findById(businessId: string, credentialId: string): Promise<ApiCredential | null> {
    const value = this.credentials.find((item) =>
      item.businessId === businessId && item.id === credentialId);
    return value ? this.public(value) : null;
  }
  async findActiveByHash(tokenHash: string): Promise<ApiCredentialWithHash | null> {
    const value = this.credentials.find((item) =>
      item.tokenHash === tokenHash && item.status === "active");
    return value ? structuredClone(value) : null;
  }
  async update(
    businessId: string,
    credentialId: string,
    input: { name: string; status: ApiCredentialStatus },
  ): Promise<ApiCredential | null> {
    const value = this.credentials.find((item) =>
      item.businessId === businessId && item.id === credentialId);
    if (!value) return null;
    value.name = input.name;
    value.status = input.status;
    value.updatedAt = credentialNow;
    return this.public(value);
  }
  private public = (value: StoredCredential): ApiCredential => ({
    id: value.id, businessId: value.businessId, name: value.name, prefix: value.prefix,
    status: value.status, createdAt: value.createdAt, updatedAt: value.updatedAt,
  });
}
