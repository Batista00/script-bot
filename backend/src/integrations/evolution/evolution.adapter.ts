import type { IntegrationsService } from "../../modules/integrations/integrations.service.js";
import {
  WhatsappProviderError,
  type WhatsappTextSender,
} from "../../modules/whatsapp/whatsapp.types.js";
import type { EvolutionHttpClient } from "./evolution.client.js";
import { EvolutionSettingsError, evolutionSettings } from "./evolution.settings.js";
import {
  EvolutionRequestRejectedError,
  EvolutionTemporarilyUnavailableError,
} from "./evolution.types.js";

export const evolutionProviderKey = "evolution";

export interface EvolutionSendTextInput {
  businessId: string;
  integrationId: string;
  to: string;
  text: string;
}

export interface EvolutionSendTextResult {
  externalMessageId: string | null;
}

/**
 * Bridges the WhatsApp module and the Evolution API. It resolves the exact
 * active integration, validates the tenant it belongs to and delegates the
 * HTTP details to the injected client. It knows nothing about Fastify or SQL.
 */
export class EvolutionAdapter implements WhatsappTextSender {
  readonly providerKey = evolutionProviderKey;

  constructor(
    private readonly integrations: Pick<IntegrationsService, "getActiveIntegrationById">,
    private readonly client: EvolutionHttpClient,
    private readonly nodeEnv: "development" | "test" | "production",
  ) {}

  async sendText(input: EvolutionSendTextInput): Promise<EvolutionSendTextResult> {
    const integration = await this.integrations.getActiveIntegrationById(
      input.integrationId,
      evolutionProviderKey,
    );
    if (!integration || integration.businessId !== input.businessId) {
      throw new WhatsappProviderError("evolution_integration_not_found");
    }
    let settings;
    try {
      settings = evolutionSettings(integration, this.nodeEnv);
    } catch (error) {
      if (!(error instanceof EvolutionSettingsError)) throw error;
      throw new WhatsappProviderError("evolution_settings_invalid");
    }
    try {
      return { externalMessageId: await this.client.sendText(settings, input.to, input.text) };
    } catch (error) {
      if (error instanceof EvolutionRequestRejectedError) {
        throw new WhatsappProviderError("evolution_request_rejected");
      }
      if (error instanceof EvolutionTemporarilyUnavailableError) {
        throw new WhatsappProviderError("evolution_temporarily_unavailable");
      }
      throw new WhatsappProviderError("evolution_send_failed");
    }
  }
}
