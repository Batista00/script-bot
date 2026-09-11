export const conversationStatuses = ["open", "pending", "human", "closed"] as const;
export type ConversationStatus = (typeof conversationStatuses)[number];

export const messageDirections = ["inbound", "outbound"] as const;
export type MessageDirection = (typeof messageDirections)[number];

export const messageStatuses = ["received", "sent", "failed"] as const;
export type MessageStatus = (typeof messageStatuses)[number];

export const whatsappChannel = "whatsapp";
/** Provider key of the Evolution integration that backs this channel. */
export const evolutionProviderKey = "evolution";

/** Persistence shape of a conversation, including the provider thread id. */
export interface Conversation {
  id: string;
  businessId: string;
  customerId: string;
  channel: string;
  externalThreadId: string | null;
  status: ConversationStatus;
  lastMessageAt: string | null;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * HTTP shape of a conversation. `external_thread_id` is intentionally omitted:
 * the customer already carries the phone number, so the raw Evolution thread
 * identifier is not needed by any client.
 */
export interface ConversationDto {
  id: string;
  businessId: string;
  customerId: string;
  channel: string;
  status: ConversationStatus;
  lastMessageAt: string | null;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  businessId: string;
  conversationId: string;
  direction: MessageDirection;
  externalMessageId: string | null;
  body: string | null;
  mediaType: string | null;
  mediaUrl: string | null;
  status: MessageStatus;
  providerError: string | null;
  createdAt: string;
}

export interface ConversationListQuery {
  status?: string;
  limit?: string;
  offset?: string;
}

export interface ConversationMessageListQuery {
  limit?: string;
  offset?: string;
}

export interface ConversationListOptions {
  limit: number;
  offset: number;
  status?: ConversationStatus;
}

export interface ConversationMessageListOptions {
  limit: number;
  offset: number;
}

export interface UpdateConversationInput {
  status: ConversationStatus;
}

export interface SendConversationMessageInput {
  text: string;
}

export interface UpsertConversationInput {
  businessId: string;
  customerId: string;
  channel: string;
  externalThreadId: string;
}

export interface UpsertConversationResult {
  conversation: Conversation;
  isNew: boolean;
}

export interface RecordInboundMessageInput {
  businessId: string;
  conversationId: string;
  externalMessageId: string | null;
  body: string | null;
  mediaType: string | null;
  mediaUrl: string | null;
}

export interface RecordInboundMessageResult {
  message: ConversationMessage;
  duplicate: boolean;
}

export interface RecordOutboundMessageInput {
  businessId: string;
  conversationId: string;
  body: string | null;
  externalMessageId: string | null;
  status: Extract<MessageStatus, "sent" | "failed">;
  providerError: string | null;
}

export interface WhatsappRepository {
  findConversationById(
    businessId: string,
    conversationId: string,
  ): Promise<Conversation | null>;
  upsertConversation(input: UpsertConversationInput): Promise<UpsertConversationResult>;
  recordInboundMessage(
    input: RecordInboundMessageInput,
  ): Promise<RecordInboundMessageResult>;
  recordOutboundMessage(input: RecordOutboundMessageInput): Promise<ConversationMessage>;
  /** Refreshes activity; inbound messages also increase the unread counter. */
  touchConversation(
    businessId: string,
    conversationId: string,
    incrementUnread: boolean,
  ): Promise<Conversation | null>;
  listConversations(
    businessId: string,
    options: ConversationListOptions,
  ): Promise<Conversation[]>;
  listMessages(
    businessId: string,
    conversationId: string,
    options: ConversationMessageListOptions,
  ): Promise<ConversationMessage[]>;
  updateConversationStatus(
    businessId: string,
    conversationId: string,
    status: ConversationStatus,
  ): Promise<Conversation | null>;
}

/** Provider-agnostic failure raised by a WhatsApp adapter. */
export class WhatsappProviderError extends Error {
  constructor(readonly providerErrorCode: string) {
    super("WhatsApp provider request failed");
    this.name = "WhatsappProviderError";
  }
}

export interface WhatsappTextSender {
  sendText(input: {
    businessId: string;
    integrationId: string;
    to: string;
    text: string;
  }): Promise<{ externalMessageId: string | null }>;
}

export interface NormalizedInboundMessage {
  phone: string;
  externalThreadId: string;
  externalMessageId: string | null;
  name: string | null;
  text: string | null;
  mediaType: string | null;
  mediaUrl: string | null;
}

export interface EvolutionWebhookContext {
  conversationId: string;
  customerId: string;
  phone: string;
  name: string | null;
  text: string | null;
  mediaType: string | null;
  mediaUrl: string | null;
  isNewConversation: boolean;
  duplicate: boolean;
}

export interface EvolutionWebhookIgnored {
  ignored: true;
}

export type EvolutionWebhookResult = EvolutionWebhookContext | EvolutionWebhookIgnored;
