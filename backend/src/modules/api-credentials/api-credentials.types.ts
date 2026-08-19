export const apiCredentialStatuses = ["active", "inactive"] as const;
export type ApiCredentialStatus = (typeof apiCredentialStatuses)[number];

export interface ApiCredential {
  id: string;
  businessId: string;
  name: string;
  prefix: string;
  status: ApiCredentialStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ApiCredentialWithHash extends ApiCredential { tokenHash: string }

export interface CreateApiCredentialInput { name: string }
export interface UpdateApiCredentialInput {
  name?: string;
  status?: ApiCredentialStatus;
}
export interface CreatedApiCredential { credential: ApiCredential; token: string }

export interface ApiCredentialsRepository {
  create(
    businessId: string,
    input: { name: string; tokenHash: string; prefix: string },
  ): Promise<ApiCredential>;
  list(businessId: string): Promise<ApiCredential[]>;
  findById(businessId: string, credentialId: string): Promise<ApiCredential | null>;
  findActiveByHash(tokenHash: string): Promise<ApiCredentialWithHash | null>;
  update(
    businessId: string,
    credentialId: string,
    input: { name: string; status: ApiCredentialStatus },
  ): Promise<ApiCredential | null>;
}

export class ApiCredentialTokenHashConflictError extends Error {}
