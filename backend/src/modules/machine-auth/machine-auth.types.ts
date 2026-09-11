import type { BusinessStatus } from "../businesses/businesses.types.js";

export interface MachineAuthContext {
  credentialId: string;
  businessId: string;
  credentialName: string;
  /**
   * Status of the credential's business, loaded with the credential so tenant
   * suspension is enforced without a second query.
   */
  businessStatus: BusinessStatus;
}
