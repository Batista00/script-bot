import { AppError } from "../../core/errors/app-error.js";
import { verifySharedSecret } from "../../integrations/telegram/telegram.service.js";
import type { IntegrationsService } from "../integrations/integrations.service.js";

export class AutomationAccessService {
  constructor(private readonly integrations:IntegrationsService) {}
  async authenticate(integrationId:string,authorization:unknown):Promise<string> {
    const integration=await this.integrations.getActiveIntegrationById(integrationId,"automation_runner");
    const secret=typeof authorization==="string" ? /^Bearer (\S+)$/.exec(authorization)?.[1] : undefined;
    if (!integration || !verifySharedSecret(secret,integration.credentials.runnerSecret)) {
      throw new AppError("Automatización no autorizada",401,"AUTOMATION_UNAUTHORIZED");
    }
    return integration.businessId;
  }
}
