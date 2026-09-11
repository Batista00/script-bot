import { createHash, timingSafeEqual } from "node:crypto";

import { AppError } from "../../core/errors/app-error.js";
import type { CustomersService } from "../customers/customers.service.js";
import type { IntegrationsService } from "../integrations/integrations.service.js";
import { normalizeEvolutionInbound } from "./whatsapp.normalize.js";
import {
  evolutionProviderKey,
  type EvolutionWebhookResult,
  type WhatsappRepository,
  whatsappChannel,
} from "./whatsapp.types.js";

const maximumSecretLength = 4096;

/**
 * Compares two secrets in constant time. Both values are hashed first so the
 * comparison sees fixed-length buffers and does not leak the secret length.
 */
export function webhookSecretMatches(provided: string | undefined, expected: string): boolean {
  if (provided === undefined) return false;
  const providedHash = createHash("sha256").update(provided, "utf8").digest();
  const expectedHash = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(providedHash, expectedHash);
}

export interface EvolutionWebhookInput {
  integrationId: string;
  webhookSecret: string | undefined;
  payload: unknown;
}

/**
 * Public ingress for Evolution `messages.upsert` events. Resolves the tenant
 * from the integration, validates the shared secret, normalizes the payload,
 * correlates it with a customer/conversation and records the inbound message
 * idempotently. The result is the contract the orchestrator consumes.
 */
export class WhatsappWebhookService {
  constructor(
    private readonly integrations: Pick<IntegrationsService, "getActiveIntegrationById">,
    private readonly customers: Pick<CustomersService, "resolve">,
    private readonly repository: WhatsappRepository,
  ) {}

  async process(input: EvolutionWebhookInput): Promise<EvolutionWebhookResult> {
    const integration = await this.integrations.getActiveIntegrationById(
      input.integrationId,
      evolutionProviderKey,
    );
    if (!integration) {
      throw new AppError("Integration not found", 404, "INTEGRATION_NOT_FOUND");
    }
    const expectedSecret = integration.credentials.webhookSecret;
    if (
      typeof expectedSecret !== "string" ||
      expectedSecret.length === 0 ||
      expectedSecret.length > maximumSecretLength
    ) {
      throw new AppError(
        "Evolution webhook is not configured",
        503,
        "WEBHOOK_NOT_CONFIGURED",
      );
    }
    if (!webhookSecretMatches(input.webhookSecret, expectedSecret)) {
      throw new AppError("Invalid webhook secret", 401, "INVALID_WEBHOOK_SECRET");
    }

    const inbound = normalizeEvolutionInbound(input.payload);
    if (!inbound) return { ignored: true };

    const businessId = integration.businessId;
    const customer = await this.customers.resolve(businessId, {
      name: inbound.name,
      phone: inbound.phone,
    });
    const { conversation, isNew } = await this.repository.upsertConversation({
      businessId,
      customerId: customer.id,
      channel: whatsappChannel,
      externalThreadId: inbound.externalThreadId,
    });
    const { message, duplicate } = await this.repository.recordInboundMessage({
      businessId,
      conversationId: conversation.id,
      externalMessageId: inbound.externalMessageId,
      body: inbound.text,
      mediaType: inbound.mediaType,
      mediaUrl: inbound.mediaUrl,
    });
    if (!duplicate) {
      await this.repository.touchConversation(businessId, conversation.id, true);
    }

    return {
      conversationId: conversation.id,
      customerId: customer.id,
      phone: customer.phone ?? inbound.phone,
      name: customer.name ?? inbound.name,
      text: message.body,
      mediaType: message.mediaType,
      mediaUrl: message.mediaUrl,
      isNewConversation: isNew && !duplicate,
      duplicate,
    };
  }
}
