import { AppError } from "../../core/errors/app-error.js";
import type { CustomersService } from "../customers/customers.service.js";
import type { IntegrationsService } from "../integrations/integrations.service.js";
import { maximumBodyLength, maximumProviderErrorLength } from "./whatsapp.normalize.js";
import {
  type Conversation,
  type ConversationDto,
  type ConversationListOptions,
  type ConversationMessage,
  type ConversationMessageListOptions,
  type ConversationStatus,
  evolutionProviderKey,
  type SendConversationMessageInput,
  type WhatsappRepository,
  WhatsappProviderError,
  type WhatsappTextSender,
} from "./whatsapp.types.js";

function toConversationDto(conversation: Conversation): ConversationDto {
  return {
    id: conversation.id,
    businessId: conversation.businessId,
    customerId: conversation.customerId,
    channel: conversation.channel,
    status: conversation.status,
    lastMessageAt: conversation.lastMessageAt,
    unreadCount: conversation.unreadCount,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

function outboundBody(value: string): string {
  if (value.trim().length === 0 || value.length > maximumBodyLength) {
    throw new AppError("Message text is invalid", 400, "INVALID_MESSAGE_BODY");
  }
  return value;
}

function providerErrorCode(error: unknown): string {
  const code = error instanceof WhatsappProviderError ? error.providerErrorCode : "provider_error";
  return code.length > maximumProviderErrorLength
    ? code.slice(0, maximumProviderErrorLength)
    : code;
}

export class WhatsappService {
  constructor(
    private readonly repository: WhatsappRepository,
    private readonly integrations: Pick<IntegrationsService, "getActiveIntegration">,
    private readonly customers: Pick<CustomersService, "getById">,
    private readonly sender: WhatsappTextSender,
  ) {}

  async listConversations(
    businessId: string,
    options: ConversationListOptions,
  ): Promise<ConversationDto[]> {
    const conversations = await this.repository.listConversations(businessId, options);
    return conversations.map(toConversationDto);
  }

  async listMessages(
    businessId: string,
    conversationId: string,
    options: ConversationMessageListOptions,
  ): Promise<ConversationMessage[]> {
    const conversation = await this.repository.findConversationById(businessId, conversationId);
    if (!conversation) {
      throw new AppError("Conversation not found", 404, "CONVERSATION_NOT_FOUND");
    }
    return this.repository.listMessages(businessId, conversationId, options);
  }

  async updateConversationStatus(
    businessId: string,
    conversationId: string,
    status: ConversationStatus,
  ): Promise<ConversationDto> {
    const conversation = await this.repository.updateConversationStatus(
      businessId,
      conversationId,
      status,
    );
    if (!conversation) {
      throw new AppError("Conversation not found", 404, "CONVERSATION_NOT_FOUND");
    }
    return toConversationDto(conversation);
  }

  async sendMessage(
    businessId: string,
    conversationId: string,
    input: SendConversationMessageInput,
  ): Promise<ConversationMessage> {
    const body = outboundBody(input.text);
    const conversation = await this.repository.findConversationById(businessId, conversationId);
    if (!conversation) {
      throw new AppError("Conversation not found", 404, "CONVERSATION_NOT_FOUND");
    }
    const customer = await this.customers.getById(businessId, conversation.customerId);
    if (customer.phone === null || customer.phone.length === 0) {
      throw new AppError(
        "Customer has no phone number",
        409,
        "CUSTOMER_PHONE_REQUIRED",
      );
    }
    const integration = await this.integrations.getActiveIntegration(
      businessId,
      evolutionProviderKey,
    );
    if (!integration) {
      throw new AppError(
        "Evolution integration is not configured",
        503,
        "WHATSAPP_NOT_CONFIGURED",
      );
    }

    let externalMessageId: string | null;
    try {
      const sent = await this.sender.sendText({
        businessId,
        integrationId: integration.id,
        to: customer.phone,
        text: body,
      });
      externalMessageId = sent.externalMessageId;
    } catch (error) {
      // The provider attempt is never lost: the failed message is persisted
      // before the controlled error reaches the client.
      await this.repository.recordOutboundMessage({
        businessId,
        conversationId,
        body,
        externalMessageId: null,
        status: "failed",
        providerError: providerErrorCode(error),
      });
      throw new AppError("WhatsApp provider rejected the message", 503, "WHATSAPP_SEND_FAILED");
    }

    const message = await this.repository.recordOutboundMessage({
      businessId,
      conversationId,
      body,
      externalMessageId,
      status: "sent",
      providerError: null,
    });
    await this.repository.touchConversation(businessId, conversationId, false);
    return message;
  }
}
