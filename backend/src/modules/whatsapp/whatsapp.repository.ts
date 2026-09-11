import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "../../core/database/database.js";
import type {
  Conversation,
  ConversationListOptions,
  ConversationMessage,
  ConversationMessageListOptions,
  ConversationStatus,
  MessageDirection,
  MessageStatus,
  RecordInboundMessageInput,
  RecordInboundMessageResult,
  RecordOutboundMessageInput,
  UpsertConversationInput,
  UpsertConversationResult,
  WhatsappRepository,
} from "./whatsapp.types.js";

interface ConversationRow extends QueryResultRow {
  id: string;
  business_id: string;
  customer_id: string;
  channel: string;
  external_thread_id: string | null;
  status: ConversationStatus;
  last_message_at: Date | string | null;
  unread_count: number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ConversationUpsertRow extends ConversationRow {
  is_new: boolean;
}

interface MessageRow extends QueryResultRow {
  id: string;
  business_id: string;
  conversation_id: string;
  direction: MessageDirection;
  external_message_id: string | null;
  body: string | null;
  media_type: string | null;
  media_url: string | null;
  status: MessageStatus;
  provider_error: string | null;
  created_at: Date | string;
}

const conversationColumns =
  "id, business_id, customer_id, channel, external_thread_id, status, " +
  "last_message_at, unread_count, created_at, updated_at";

const messageColumns =
  "id, business_id, conversation_id, direction, external_message_id, body, " +
  "media_type, media_url, status, provider_error, created_at";

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toNullableIsoString(value: Date | string | null): string | null {
  return value === null ? null : toIsoString(value);
}

function mapConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    businessId: row.business_id,
    customerId: row.customer_id,
    channel: row.channel,
    externalThreadId: row.external_thread_id,
    status: row.status,
    lastMessageAt: toNullableIsoString(row.last_message_at),
    unreadCount: row.unread_count,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    businessId: row.business_id,
    conversationId: row.conversation_id,
    direction: row.direction,
    externalMessageId: row.external_message_id,
    body: row.body,
    mediaType: row.media_type,
    mediaUrl: row.media_url,
    status: row.status,
    providerError: row.provider_error,
    createdAt: toIsoString(row.created_at),
  };
}

export class PostgresWhatsappRepository implements WhatsappRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async findConversationById(
    businessId: string,
    conversationId: string,
  ): Promise<Conversation | null> {
    const result = await this.db.query<ConversationRow>(
      `SELECT ${conversationColumns}
       FROM conversations
       WHERE business_id = $1 AND id = $2`,
      [businessId, conversationId],
    );
    return result.rows[0] ? mapConversation(result.rows[0]) : null;
  }

  async upsertConversation(input: UpsertConversationInput): Promise<UpsertConversationResult> {
    const result = await this.db.query<ConversationUpsertRow>(
      `INSERT INTO conversations (business_id, customer_id, channel, external_thread_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (business_id, channel, external_thread_id)
       DO UPDATE SET customer_id = EXCLUDED.customer_id, updated_at = now()
       RETURNING ${conversationColumns}, (xmax = 0) AS is_new`,
      [input.businessId, input.customerId, input.channel, input.externalThreadId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("PostgreSQL did not return the upserted conversation");
    return { conversation: mapConversation(row), isNew: row.is_new };
  }

  async recordInboundMessage(
    input: RecordInboundMessageInput,
  ): Promise<RecordInboundMessageResult> {
    const inserted = await this.db.query<MessageRow>(
      `INSERT INTO conversation_messages
         (business_id, conversation_id, direction, external_message_id, body,
          media_type, media_url, status)
       VALUES ($1, $2, 'inbound', $3, $4, $5, $6, 'received')
       ON CONFLICT (business_id, external_message_id)
         WHERE external_message_id IS NOT NULL
       DO NOTHING
       RETURNING ${messageColumns}`,
      [
        input.businessId,
        input.conversationId,
        input.externalMessageId,
        input.body,
        input.mediaType,
        input.mediaUrl,
      ],
    );
    const insertedRow = inserted.rows[0];
    if (insertedRow) return { message: mapMessage(insertedRow), duplicate: false };
    if (input.externalMessageId === null) {
      throw new Error("PostgreSQL did not return the recorded inbound message");
    }
    // A retry of an Evolution delivery: return the message already stored so
    // the caller can answer idempotently without duplicating side effects.
    const existing = await this.db.query<MessageRow>(
      `SELECT ${messageColumns}
       FROM conversation_messages
       WHERE business_id = $1 AND external_message_id = $2`,
      [input.businessId, input.externalMessageId],
    );
    const existingRow = existing.rows[0];
    if (!existingRow) throw new Error("PostgreSQL did not return the deduplicated message");
    return { message: mapMessage(existingRow), duplicate: true };
  }

  async recordOutboundMessage(input: RecordOutboundMessageInput): Promise<ConversationMessage> {
    const result = await this.db.query<MessageRow>(
      `INSERT INTO conversation_messages
         (business_id, conversation_id, direction, external_message_id, body,
          media_type, media_url, status, provider_error)
       VALUES ($1, $2, 'outbound', $3, $4, NULL, NULL, $5, $6)
       RETURNING ${messageColumns}`,
      [
        input.businessId,
        input.conversationId,
        input.externalMessageId,
        input.body,
        input.status,
        input.providerError,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("PostgreSQL did not return the outbound message");
    return mapMessage(row);
  }

  async touchConversation(
    businessId: string,
    conversationId: string,
    incrementUnread: boolean,
  ): Promise<Conversation | null> {
    const result = await this.db.query<ConversationRow>(
      `UPDATE conversations
       SET last_message_at = now(),
           unread_count = unread_count + CASE WHEN $3::boolean THEN 1 ELSE 0 END,
           updated_at = now()
       WHERE business_id = $1 AND id = $2
       RETURNING ${conversationColumns}`,
      [businessId, conversationId, incrementUnread],
    );
    return result.rows[0] ? mapConversation(result.rows[0]) : null;
  }

  async listConversations(
    businessId: string,
    options: ConversationListOptions,
  ): Promise<Conversation[]> {
    const result = await this.db.query<ConversationRow>(
      `SELECT ${conversationColumns}
       FROM conversations
       WHERE business_id = $1
         AND ($2::text IS NULL OR status = $2::conversation_status)
       ORDER BY last_message_at DESC NULLS LAST, created_at DESC, id DESC
       LIMIT $3 OFFSET $4`,
      [businessId, options.status ?? null, options.limit, options.offset],
    );
    return result.rows.map(mapConversation);
  }

  async listMessages(
    businessId: string,
    conversationId: string,
    options: ConversationMessageListOptions,
  ): Promise<ConversationMessage[]> {
    const result = await this.db.query<MessageRow>(
      `SELECT ${messageColumns}
       FROM conversation_messages
       WHERE business_id = $1 AND conversation_id = $2
       ORDER BY created_at DESC, id DESC
       LIMIT $3 OFFSET $4`,
      [businessId, conversationId, options.limit, options.offset],
    );
    return result.rows.map(mapMessage);
  }

  async updateConversationStatus(
    businessId: string,
    conversationId: string,
    status: ConversationStatus,
  ): Promise<Conversation | null> {
    const result = await this.db.query<ConversationRow>(
      `UPDATE conversations
       SET status = $3::conversation_status, updated_at = now()
       WHERE business_id = $1 AND id = $2
       RETURNING ${conversationColumns}`,
      [businessId, conversationId, status],
    );
    return result.rows[0] ? mapConversation(result.rows[0]) : null;
  }
}
