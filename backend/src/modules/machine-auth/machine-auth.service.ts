import type { ApiCredentialsRepository } from "../api-credentials/api-credentials.types.js";
import {
  hashApiCredentialToken,
  isApiCredentialToken,
} from "../api-credentials/api-credentials.crypto.js";
import type { MachineAuthContext } from "./machine-auth.types.js";

export class MachineAuthService {
  constructor(private readonly credentials: ApiCredentialsRepository) {}

  async authenticate(token: string): Promise<MachineAuthContext | null> {
    if (!isApiCredentialToken(token)) return null;
    const credential = await this.credentials.findActiveByHash(hashApiCredentialToken(token));
    if (!credential) return null;
    return {
      credentialId: credential.id,
      businessId: credential.businessId,
      credentialName: credential.name,
    };
  }
}
