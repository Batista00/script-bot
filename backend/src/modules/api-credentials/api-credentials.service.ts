import { AppError } from "../../core/errors/app-error.js";
import {
  apiCredentialTokenPrefix,
  generateApiCredentialToken,
  hashApiCredentialToken,
} from "./api-credentials.crypto.js";
import {
  type ApiCredential,
  type ApiCredentialsRepository,
  apiCredentialStatuses,
  ApiCredentialTokenHashConflictError,
  type CreatedApiCredential,
  type CreateApiCredentialInput,
  type UpdateApiCredentialInput,
} from "./api-credentials.types.js";

function normalizeName(value: string): string {
  const name = value.trim();
  if (name.length === 0 || name.length > 120) {
    throw new AppError(
      "API credential name must contain between 1 and 120 characters",
      400,
      "INVALID_API_CREDENTIAL_NAME",
    );
  }
  return name;
}

function notFound(): AppError {
  return new AppError("API credential not found", 404, "API_CREDENTIAL_NOT_FOUND");
}

export class ApiCredentialsService {
  constructor(
    private readonly repository: ApiCredentialsRepository,
    private readonly generateToken: () => string = generateApiCredentialToken,
  ) {}

  async create(businessId: string, input: CreateApiCredentialInput): Promise<CreatedApiCredential> {
    const name = normalizeName(input.name);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = this.generateToken();
      try {
        const credential = await this.repository.create(businessId, {
          name,
          tokenHash: hashApiCredentialToken(token),
          prefix: apiCredentialTokenPrefix(token),
        });
        return { credential, token };
      } catch (error) {
        if (!(error instanceof ApiCredentialTokenHashConflictError) || attempt === 1) throw error;
      }
    }
    throw new Error("API credential token generation failed");
  }

  list(businessId: string): Promise<ApiCredential[]> {
    return this.repository.list(businessId);
  }

  async getById(businessId: string, credentialId: string): Promise<ApiCredential> {
    const credential = await this.repository.findById(businessId, credentialId);
    if (!credential) throw notFound();
    return credential;
  }

  async update(
    businessId: string,
    credentialId: string,
    input: UpdateApiCredentialInput,
  ): Promise<ApiCredential> {
    if (input.name === undefined && input.status === undefined) {
      throw new AppError(
        "At least one API credential field must be provided",
        400,
        "EMPTY_API_CREDENTIAL_UPDATE",
      );
    }
    if (input.status !== undefined && !apiCredentialStatuses.includes(input.status)) {
      throw new AppError(
        "Invalid API credential status", 400, "INVALID_API_CREDENTIAL_STATUS",
      );
    }
    const current = await this.getById(businessId, credentialId);
    const credential = await this.repository.update(businessId, credentialId, {
      name: input.name === undefined ? current.name : normalizeName(input.name),
      status: input.status ?? current.status,
    });
    if (!credential) throw notFound();
    return credential;
  }
}
