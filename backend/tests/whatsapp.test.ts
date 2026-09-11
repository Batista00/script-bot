import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import Fastify from "fastify";

import { AppError } from "../src/core/errors/app-error.js";
import { registerErrorHandler } from "../src/core/errors/error-handler.js";
import { EvolutionAdapter } from "../src/integrations/evolution/evolution.adapter.js";
import { NativeEvolutionClient } from "../src/integrations/evolution/evolution.client.js";
import {
  EvolutionSettingsError,
  evolutionSettings,
} from "../src/integrations/evolution/evolution.settings.js";
import {
  EvolutionRequestRejectedError,
  EvolutionTemporarilyUnavailableError,
} from "../src/integrations/evolution/evolution.types.js";
import { CustomersService } from "../src/modules/customers/customers.service.js";
import {
  type Customer,
  type CustomerContact,
  type CustomerContactConflict,
  type CustomerListOptions,
  type CustomerPersistenceInput,
  type CustomersRepository,
} from "../src/modules/customers/customers.types.js";
import type { ActiveIntegration } from "../src/modules/integrations/integrations.types.js";
import {
  normalizeEvolutionInbound,
  normalizePhoneFromJid,
} from "../src/modules/whatsapp/whatsapp.normalize.js";
import { whatsappRoutes } from "../src/modules/whatsapp/whatsapp.routes.js";
import { WhatsappService } from "../src/modules/whatsapp/whatsapp.service.js";
import {
  type Conversation,
  type ConversationListOptions,
  type ConversationMessage,
  type ConversationMessageListOptions,
  type ConversationStatus,
  type RecordInboundMessageInput,
  type RecordInboundMessageResult,
  type RecordOutboundMessageInput,
  type UpsertConversationInput,
  type UpsertConversationResult,
  WhatsappProviderError,
  type WhatsappRepository,
  type WhatsappTextSender,
  whatsappChannel,
} from "../src/modules/whatsapp/whatsapp.types.js";
import { WhatsappWebhookService } from "../src/modules/whatsapp/whatsapp.webhook.service.js";

const businessA = "0e2f6f5e-72e1-4ec9-8680-0c2185d91c68";
const businessB = "9d1b85eb-ecbf-479c-838f-80e53e98c9a8";
const integrationId = "60878fd4-9a90-4f74-8905-d736c8b6ea11";
const webhookSecret = "evolution-webhook-secret";
const now = "2026-08-20T12:00:00.000Z";

class MemoryCustomersRepository implements CustomersRepository {
  readonly customers: Customer[] = [];

  async create(businessId: string, input: CustomerPersistenceInput): Promise<Customer> {
    const customer: Customer = {
      id: randomUUID(),
      businessId,
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.customers.push(customer);
    return customer;
  }

  async list(businessId: string, options: CustomerListOptions): Promise<Customer[]> {
    return this.customers
      .filter((customer) => customer.businessId === businessId)
      .slice(options.offset, options.offset + options.limit);
  }

  async findById(businessId: string, customerId: string): Promise<Customer | null> {
    return this.customers.find(
      (customer) => customer.businessId === businessId && customer.id === customerId,
    ) ?? null;
  }

  async findByContacts(businessId: string, contact: CustomerContact): Promise<Customer[]> {
    return this.customers.filter((customer) => customer.businessId === businessId &&
      ((contact.phone !== null && customer.phone === contact.phone) ||
       (contact.email !== null && customer.email?.toLowerCase() === contact.email.toLowerCase())));
  }

  async findContactConflict(
    businessId: string,
    contact: CustomerContact,
    excludeCustomerId?: string,
  ): Promise<CustomerContactConflict | null> {
    const candidates = this.customers.filter(
      (customer) => customer.businessId === businessId && customer.id !== excludeCustomerId,
    );
    if (contact.phone && candidates.some((customer) => customer.phone === contact.phone)) {
      return "phone";
    }
    if (
      contact.email &&
      candidates.some((customer) => customer.email?.toLowerCase() === contact.email?.toLowerCase())
    ) {
      return "email";
    }
    return null;
  }

  async update(
    businessId: string,
    customerId: string,
    input: CustomerPersistenceInput,
  ): Promise<Customer | null> {
    const index = this.customers.findIndex(
      (customer) => customer.businessId === businessId && customer.id === customerId,
    );
    const existing = this.customers[index];
    if (!existing) return null;
    const updated: Customer = { ...existing, ...input, updatedAt: now };
    this.customers[index] = updated;
    return updated;
  }
}

class MemoryWhatsappRepository implements WhatsappRepository {
  readonly conversations: Conversation[] = [];
  readonly messages: ConversationMessage[] = [];
  private tick = 0;

  private timestamp(): string {
    this.tick += 1;
    return new Date(Date.UTC(2026, 7, 20, 12, 0, 0) + this.tick * 1_000).toISOString();
  }

  async findConversationById(
    businessId: string,
    conversationId: string,
  ): Promise<Conversation | null> {
    return this.conversations.find(
      (conversation) =>
        conversation.businessId === businessId && conversation.id === conversationId,
    ) ?? null;
  }

  async upsertConversation(input: UpsertConversationInput): Promise<UpsertConversationResult> {
    const existing = this.conversations.find(
      (conversation) =>
        conversation.businessId === input.businessId &&
        conversation.channel === input.channel &&
        conversation.externalThreadId === input.externalThreadId,
    );
    if (existing) {
      existing.customerId = input.customerId;
      existing.updatedAt = this.timestamp();
      return { conversation: existing, isNew: false };
    }
    const timestamp = this.timestamp();
    const conversation: Conversation = {
      id: randomUUID(),
      businessId: input.businessId,
      customerId: input.customerId,
      channel: input.channel,
      externalThreadId: input.externalThreadId,
      status: "open",
      lastMessageAt: null,
      unreadCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.conversations.push(conversation);
    return { conversation, isNew: true };
  }

  async recordInboundMessage(
    input: RecordInboundMessageInput,
  ): Promise<RecordInboundMessageResult> {
    if (input.externalMessageId !== null) {
      const duplicate = this.messages.find(
        (message) =>
          message.businessId === input.businessId &&
          message.externalMessageId === input.externalMessageId,
      );
      if (duplicate) return { message: duplicate, duplicate: true };
    }
    const message: ConversationMessage = {
      id: randomUUID(),
      businessId: input.businessId,
      conversationId: input.conversationId,
      direction: "inbound",
      externalMessageId: input.externalMessageId,
      body: input.body,
      mediaType: input.mediaType,
      mediaUrl: input.mediaUrl,
      status: "received",
      providerError: null,
      createdAt: this.timestamp(),
    };
    this.messages.push(message);
    return { message, duplicate: false };
  }

  async recordOutboundMessage(input: RecordOutboundMessageInput): Promise<ConversationMessage> {
    const message: ConversationMessage = {
      id: randomUUID(),
      businessId: input.businessId,
      conversationId: input.conversationId,
      direction: "outbound",
      externalMessageId: input.externalMessageId,
      body: input.body,
      mediaType: null,
      mediaUrl: null,
      status: input.status,
      providerError: input.providerError,
      createdAt: this.timestamp(),
    };
    this.messages.push(message);
    return message;
  }

  async touchConversation(
    businessId: string,
    conversationId: string,
    incrementUnread: boolean,
  ): Promise<Conversation | null> {
    const conversation = await this.findConversationById(businessId, conversationId);
    if (!conversation) return null;
    conversation.lastMessageAt = this.timestamp();
    conversation.updatedAt = conversation.lastMessageAt;
    if (incrementUnread) conversation.unreadCount += 1;
    return conversation;
  }

  async listConversations(
    businessId: string,
    options: ConversationListOptions,
  ): Promise<Conversation[]> {
    return this.conversations
      .filter(
        (conversation) =>
          conversation.businessId === businessId &&
          (options.status === undefined || conversation.status === options.status),
      )
      .sort((left, right) => (right.lastMessageAt ?? "").localeCompare(left.lastMessageAt ?? ""))
      .slice(options.offset, options.offset + options.limit);
  }

  async listMessages(
    businessId: string,
    conversationId: string,
    options: ConversationMessageListOptions,
  ): Promise<ConversationMessage[]> {
    return this.messages
      .filter(
        (message) =>
          message.businessId === businessId && message.conversationId === conversationId,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(options.offset, options.offset + options.limit);
  }

  async updateConversationStatus(
    businessId: string,
    conversationId: string,
    status: ConversationStatus,
  ): Promise<Conversation | null> {
    const conversation = await this.findConversationById(businessId, conversationId);
    if (!conversation) return null;
    conversation.status = status;
    conversation.updatedAt = this.timestamp();
    return conversation;
  }
}

class FakeIntegrations {
  integration: ActiveIntegration | null = {
    id: integrationId,
    businessId: businessA,
    providerKey: "evolution",
    config: { baseUrl: "https://evo.example.com", instance: "bot-whatsap" },
    credentials: { apiKey: "evolution-api-key", webhookSecret },
  };

  async getActiveIntegration(
    businessId: string,
    providerKey: string,
  ): Promise<ActiveIntegration | null> {
    const integration = this.integration;
    if (!integration) return null;
    if (integration.businessId !== businessId || integration.providerKey !== providerKey) {
      return null;
    }
    return integration;
  }

  async getActiveIntegrationById(
    requestedIntegrationId: string,
    providerKey: string,
  ): Promise<ActiveIntegration | null> {
    const integration = this.integration;
    if (!integration) return null;
    if (integration.id !== requestedIntegrationId || integration.providerKey !== providerKey) {
      return null;
    }
    return integration;
  }
}

class FakeSender implements WhatsappTextSender {
  readonly calls: Array<{
    businessId: string;
    integrationId: string;
    to: string;
    text: string;
  }> = [];
  result: { externalMessageId: string | null } = { externalMessageId: "provider-message-id" };
  error: Error | null = null;

  async sendText(input: {
    businessId: string;
    integrationId: string;
    to: string;
    text: string;
  }): Promise<{ externalMessageId: string | null }> {
    this.calls.push(input);
    if (this.error) throw this.error;
    return this.result;
  }
}

function createFixture() {
  const customerRepository = new MemoryCustomersRepository();
  const customerService = new CustomersService(customerRepository);
  const repository = new MemoryWhatsappRepository();
  const integrations = new FakeIntegrations();
  const sender = new FakeSender();
  const service = new WhatsappService(repository, integrations, customerService, sender);
  const webhookService = new WhatsappWebhookService(integrations, customerService, repository);
  return { customerRepository, customerService, repository, integrations, sender, service, webhookService };
}

async function buildWhatsappApp(
  service: WhatsappService,
  webhookService: WhatsappWebhookService,
) {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(whatsappRoutes, { service, webhookService });
  return app;
}

function inboundPayload(options: {
  remoteJid?: string;
  messageId?: string;
  fromMe?: boolean;
  messageType?: string;
  message?: Record<string, unknown>;
  pushName?: string | null;
  event?: string;
} = {}): Record<string, unknown> {
  const remoteJid = options.remoteJid ?? "56911112222@s.whatsapp.net";
  const messageId = options.messageId ?? "3EB0INBOUND1";
  const fromMe = options.fromMe ?? false;
  const messageType = options.messageType ?? "conversation";
  const message = options.message ?? { conversation: "Hola" };
  const pushName = options.pushName === undefined ? "Ana" : options.pushName;
  const event = options.event ?? "messages.upsert";
  return {
    event,
    instance: "bot-whatsap",
    data: {
      key: { remoteJid, fromMe, id: messageId },
      pushName,
      messageType,
      message,
    },
  };
}

function hasAppError(code: string, statusCode?: number): (error: unknown) => boolean {
  return (error) =>
    error instanceof AppError &&
    error.code === code &&
    (statusCode === undefined || error.statusCode === statusCode);
}

test("Evolution remoteJid variants normalize to a bare phone number", () => {
  assert.equal(normalizePhoneFromJid("56911112222@s.whatsapp.net"), "56911112222");
  assert.equal(normalizePhoneFromJid("56911112222@c.us"), "56911112222");
  assert.equal(normalizePhoneFromJid("56911112222:12@s.whatsapp.net"), "56911112222");
  assert.equal(normalizePhoneFromJid("56911112222:12@c.us"), "56911112222");
  assert.equal(normalizePhoneFromJid("56911112222"), "56911112222");
  assert.equal(normalizePhoneFromJid("120363000000000000@g.us"), null);
  assert.equal(normalizePhoneFromJid("status@broadcast"), null);
  assert.equal(normalizePhoneFromJid("not-a-phone@s.whatsapp.net"), null);
});

test("Evolution payloads normalize text and media", () => {
  const conversation = normalizeEvolutionInbound(inboundPayload());
  assert.equal(conversation?.text, "Hola");
  assert.equal(conversation?.mediaType, null);
  assert.equal(conversation?.phone, "56911112222");
  assert.equal(conversation?.externalThreadId, "56911112222@s.whatsapp.net");
  assert.equal(conversation?.externalMessageId, "3EB0INBOUND1");
  assert.equal(conversation?.name, "Ana");

  const extended = normalizeEvolutionInbound(inboundPayload({
    message: { extendedTextMessage: { text: "Texto extendido" } },
  }));
  assert.equal(extended?.text, "Texto extendido");

  const image = normalizeEvolutionInbound(inboundPayload({
    message: { imageMessage: { mimetype: "image/jpeg", url: "https://cdn.example.com/a.jpg" } },
  }));
  assert.equal(image?.text, null);
  assert.equal(image?.mediaType, "image");
  assert.equal(image?.mediaUrl, "https://cdn.example.com/a.jpg");

  const audio = normalizeEvolutionInbound(inboundPayload({
    message: { audioMessage: { mimetype: "audio/ogg" } },
  }));
  assert.equal(audio?.mediaType, "audio");
  assert.equal(audio?.mediaUrl, null);

  const document = normalizeEvolutionInbound(inboundPayload({
    message: { documentMessage: { mimetype: "application/pdf", url: "https://cdn.example.com/a.pdf" } },
  }));
  assert.equal(document?.mediaType, "document");
  assert.equal(document?.mediaUrl, "https://cdn.example.com/a.pdf");
});

test("Evolution payloads that are not inbound customer messages are ignored", () => {
  assert.equal(normalizeEvolutionInbound(inboundPayload({ fromMe: true })), null);
  assert.equal(
    normalizeEvolutionInbound(inboundPayload({ messageType: "protocolMessage" })),
    null,
  );
  assert.equal(normalizeEvolutionInbound(inboundPayload({ remoteJid: "123@g.us" })), null);
  assert.equal(normalizeEvolutionInbound(inboundPayload({ event: "connection.update" })), null);
  assert.equal(normalizeEvolutionInbound(null), null);
});

test("inbound webhook correlates the customer and conversation and is idempotent", async (t) => {
  const fixture = createFixture();
  const app = await buildWhatsappApp(fixture.service, fixture.webhookService);
  t.after(async () => app.close());
  const url = `/webhooks/evolution/${integrationId}`;
  const headers = { "x-webhook-secret": webhookSecret };

  const first = await app.inject({
    method: "POST",
    url,
    headers,
    payload: inboundPayload({ messageId: "3EB0INBOUND1", pushName: " Ana " }),
  });
  assert.equal(first.statusCode, 200, JSON.stringify(first.json()));
  const firstBody = first.json();
  assert.equal(firstBody.duplicate, false);
  assert.equal(firstBody.isNewConversation, true);
  assert.equal(firstBody.phone, "56911112222");
  assert.equal(firstBody.name, "Ana");
  assert.equal(firstBody.text, "Hola");
  assert.equal(firstBody.conversationId, fixture.repository.conversations[0]?.id);
  assert.equal(firstBody.customerId, fixture.customerRepository.customers[0]?.id);
  assert.equal(fixture.repository.messages.length, 1);
  assert.equal(fixture.repository.conversations[0]?.unreadCount, 1);

  const retry = await app.inject({
    method: "POST",
    url,
    headers,
    payload: inboundPayload({ messageId: "3EB0INBOUND1", pushName: " Ana " }),
  });
  assert.equal(retry.statusCode, 200);
  const retryBody = retry.json();
  assert.equal(retryBody.duplicate, true);
  assert.equal(retryBody.isNewConversation, false);
  assert.equal(retryBody.conversationId, firstBody.conversationId);
  assert.equal(fixture.repository.messages.length, 1);
  assert.equal(fixture.repository.conversations[0]?.unreadCount, 1);

  const secondMessage = await app.inject({
    method: "POST",
    url,
    headers,
    payload: inboundPayload({ messageId: "3EB0INBOUND2", message: { conversation: "Otra vez" } }),
  });
  assert.equal(secondMessage.statusCode, 200);
  assert.equal(secondMessage.json().duplicate, false);
  assert.equal(secondMessage.json().isNewConversation, false);
  assert.equal(secondMessage.json().conversationId, firstBody.conversationId);
  assert.equal(fixture.repository.conversations.length, 1);
  assert.equal(fixture.repository.messages.length, 2);
  assert.equal(fixture.repository.conversations[0]?.unreadCount, 2);
  assert.equal(fixture.customerRepository.customers.length, 1);
});

test("a different thread creates a second conversation for the same business", async (t) => {
  const fixture = createFixture();
  const app = await buildWhatsappApp(fixture.service, fixture.webhookService);
  t.after(async () => app.close());
  const url = `/webhooks/evolution/${integrationId}`;
  const headers = { "x-webhook-secret": webhookSecret };

  await app.inject({
    method: "POST", url, headers,
    payload: inboundPayload({ remoteJid: "56911112222@s.whatsapp.net", messageId: "A1" }),
  });
  const other = await app.inject({
    method: "POST", url, headers,
    payload: inboundPayload({ remoteJid: "56933334444@c.us", messageId: "A2", pushName: "Beto" }),
  });
  assert.equal(other.statusCode, 200);
  assert.equal(other.json().isNewConversation, true);
  assert.equal(other.json().phone, "56933334444");
  assert.equal(fixture.repository.conversations.length, 2);
});

test("ignored events answer 200 without touching the database", async (t) => {
  const fixture = createFixture();
  const app = await buildWhatsappApp(fixture.service, fixture.webhookService);
  t.after(async () => app.close());
  const url = `/webhooks/evolution/${integrationId}`;

  const owned = await app.inject({
    method: "POST",
    url,
    headers: { "x-webhook-secret": webhookSecret },
    payload: inboundPayload({ fromMe: true }),
  });
  assert.equal(owned.statusCode, 200);
  assert.deepEqual(owned.json(), { ignored: true });
  assert.equal(fixture.repository.messages.length, 0);
  assert.equal(fixture.customerRepository.customers.length, 0);
});

test("an invalid webhook secret is rejected with 401", async (t) => {
  const fixture = createFixture();
  const app = await buildWhatsappApp(fixture.service, fixture.webhookService);
  t.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: `/webhooks/evolution/${integrationId}`,
    headers: { "x-webhook-secret": "wrong-secret" },
    payload: inboundPayload(),
  });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "INVALID_WEBHOOK_SECRET");
  assert.equal(fixture.customerRepository.customers.length, 0);

  const missing = await app.inject({
    method: "POST",
    url: `/webhooks/evolution/${integrationId}`,
    payload: inboundPayload(),
  });
  assert.equal(missing.statusCode, 401);
});

test("an unknown or inactive integration answers 404", async (t) => {
  const fixture = createFixture();
  const app = await buildWhatsappApp(fixture.service, fixture.webhookService);
  t.after(async () => app.close());

  const unknown = await app.inject({
    method: "POST",
    url: "/webhooks/evolution/11111111-1111-4111-8111-111111111111",
    headers: { "x-webhook-secret": webhookSecret },
    payload: inboundPayload(),
  });
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().error.code, "INTEGRATION_NOT_FOUND");

  fixture.integrations.integration = null;
  const inactive = await app.inject({
    method: "POST",
    url: `/webhooks/evolution/${integrationId}`,
    headers: { "x-webhook-secret": webhookSecret },
    payload: inboundPayload(),
  });
  assert.equal(inactive.statusCode, 404);
});

test("a missing webhookSecret answers 503 WEBHOOK_NOT_CONFIGURED", async (t) => {
  const fixture = createFixture();
  fixture.integrations.integration = {
    id: integrationId,
    businessId: businessA,
    providerKey: "evolution",
    config: { baseUrl: "https://evo.example.com", instance: "bot-whatsap" },
    credentials: { apiKey: "evolution-api-key" },
  };
  const app = await buildWhatsappApp(fixture.service, fixture.webhookService);
  t.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: `/webhooks/evolution/${integrationId}`,
    headers: { "x-webhook-secret": webhookSecret },
    payload: inboundPayload(),
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error.code, "WEBHOOK_NOT_CONFIGURED");
});

test("outbound messages are persisted as sent through the adapter", async () => {
  const fixture = createFixture();
  const customer = await fixture.customerService.resolve(businessA, {
    name: "Ana",
    phone: "56911112222",
  });
  const { conversation } = await fixture.repository.upsertConversation({
    businessId: businessA,
    customerId: customer.id,
    channel: whatsappChannel,
    externalThreadId: "56911112222@s.whatsapp.net",
  });
  fixture.sender.result = { externalMessageId: "provider-message-1" };

  const message = await fixture.service.sendMessage(businessA, conversation.id, {
    text: "Hola Ana",
  });

  assert.equal(message.direction, "outbound");
  assert.equal(message.status, "sent");
  assert.equal(message.body, "Hola Ana");
  assert.equal(message.externalMessageId, "provider-message-1");
  assert.equal(message.providerError, null);
  assert.equal(fixture.sender.calls.length, 1);
  assert.equal(fixture.sender.calls[0]?.to, "56911112222");
  assert.equal(fixture.sender.calls[0]?.integrationId, integrationId);
});

test("a rejected provider keeps the failed outbound message and returns 503", async () => {
  const fixture = createFixture();
  const customer = await fixture.customerService.resolve(businessA, { phone: "56911112222" });
  const { conversation } = await fixture.repository.upsertConversation({
    businessId: businessA,
    customerId: customer.id,
    channel: whatsappChannel,
    externalThreadId: "56911112222@s.whatsapp.net",
  });
  fixture.sender.error = new WhatsappProviderError("evolution_request_rejected");

  await assert.rejects(
    fixture.service.sendMessage(businessA, conversation.id, { text: "Hola" }),
    hasAppError("WHATSAPP_SEND_FAILED", 503),
  );
  assert.equal(fixture.repository.messages.length, 1);
  const failed = fixture.repository.messages[0];
  assert.equal(failed?.direction, "outbound");
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.providerError, "evolution_request_rejected");
  assert.equal(failed?.externalMessageId, null);
});

test("sending validates the conversation, the body and the integration", async () => {
  const fixture = createFixture();
  const customer = await fixture.customerService.resolve(businessA, { phone: "56911112222" });
  const { conversation } = await fixture.repository.upsertConversation({
    businessId: businessA,
    customerId: customer.id,
    channel: whatsappChannel,
    externalThreadId: "56911112222@s.whatsapp.net",
  });

  await assert.rejects(
    fixture.service.sendMessage(businessA, randomUUID(), { text: "Hola" }),
    hasAppError("CONVERSATION_NOT_FOUND", 404),
  );
  await assert.rejects(
    fixture.service.sendMessage(businessA, conversation.id, { text: "   " }),
    hasAppError("INVALID_MESSAGE_BODY", 400),
  );
  await assert.rejects(
    fixture.service.sendMessage(businessB, conversation.id, { text: "Hola" }),
    hasAppError("CONVERSATION_NOT_FOUND", 404),
  );

  await fixture.repository.updateConversationStatus(businessA, conversation.id, "closed");
  const closed = await fixture.service.updateConversationStatus(
    businessA,
    conversation.id,
    "human",
  );
  assert.equal(closed.status, "human");
  await assert.rejects(
    fixture.service.updateConversationStatus(businessB, conversation.id, "open"),
    hasAppError("CONVERSATION_NOT_FOUND", 404),
  );
});

test("listing conversations and messages is isolated by business", async () => {
  const fixture = createFixture();
  const customer = await fixture.customerService.resolve(businessA, { phone: "56911112222" });
  const { conversation } = await fixture.repository.upsertConversation({
    businessId: businessA,
    customerId: customer.id,
    channel: whatsappChannel,
    externalThreadId: "56911112222@s.whatsapp.net",
  });
  await fixture.repository.recordInboundMessage({
    businessId: businessA,
    conversationId: conversation.id,
    externalMessageId: "M1",
    body: "Hola",
    mediaType: null,
    mediaUrl: null,
  });

  const conversations = await fixture.service.listConversations(businessA, {
    limit: 50,
    offset: 0,
  });
  assert.equal(conversations.length, 1);
  assert.equal(conversations[0]?.id, conversation.id);
  assert.equal("externalThreadId" in (conversations[0] ?? {}), false);

  const messages = await fixture.service.listMessages(businessA, conversation.id, {
    limit: 50,
    offset: 0,
  });
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.body, "Hola");

  assert.deepEqual(
    await fixture.service.listConversations(businessB, { limit: 50, offset: 0 }),
    [],
  );
  await assert.rejects(
    fixture.service.listMessages(businessB, conversation.id, { limit: 50, offset: 0 }),
    hasAppError("CONVERSATION_NOT_FOUND", 404),
  );
});

test("the native Evolution client posts the text with the apikey header", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ key: { id: "3EB0SENT" }, status: "PENDING" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  const client = new NativeEvolutionClient(fakeFetch);

  const messageId = await client.sendText(
    { baseUrl: "https://evo.example.com", instance: "bot-whatsap", apiKey: "secret-key" },
    "56911112222",
    "Hola",
  );

  assert.equal(messageId, "3EB0SENT");
  assert.equal(calls[0]?.url, "https://evo.example.com/message/sendText/bot-whatsap");
  assert.equal(calls[0]?.init?.method, "POST");
  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers.apikey, "secret-key");
  assert.equal(headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    number: "56911112222",
    text: "Hola",
  });
});

test("the native Evolution client maps HTTP and transport failures", async () => {
  const clientWith = (status: number) => new NativeEvolutionClient(
    (async () => new Response("provider body with secret-key", { status })) as unknown as typeof fetch,
  );

  await assert.rejects(
    clientWith(500).sendText(
      { baseUrl: "https://evo.example.com", instance: "bot-whatsap", apiKey: "secret-key" },
      "56911112222", "Hola",
    ),
    (error: unknown) => error instanceof EvolutionTemporarilyUnavailableError &&
      !error.message.includes("secret-key") && !error.message.includes("provider body"),
  );
  await assert.rejects(
    clientWith(401).sendText(
      { baseUrl: "https://evo.example.com", instance: "bot-whatsap", apiKey: "secret-key" },
      "56911112222", "Hola",
    ),
    (error: unknown) => error instanceof EvolutionRequestRejectedError &&
      !error.message.includes("secret-key"),
  );
  const networkClient = new NativeEvolutionClient(
    (async () => { throw new Error("ECONNREFUSED secret-key"); }) as unknown as typeof fetch,
  );
  await assert.rejects(
    networkClient.sendText(
      { baseUrl: "https://evo.example.com", instance: "bot-whatsap", apiKey: "secret-key" },
      "56911112222", "Hola",
    ),
    (error: unknown) => error instanceof EvolutionTemporarilyUnavailableError,
  );
});

test("evolution settings require a valid config and HTTPS outside tests", () => {
  const integration: ActiveIntegration = {
    id: integrationId,
    businessId: businessA,
    providerKey: "evolution",
    config: { baseUrl: "https://evo.example.com/", instance: "bot-whatsap" },
    credentials: { apiKey: "secret-key" },
  };
  assert.deepEqual(evolutionSettings(integration, "production"), {
    baseUrl: "https://evo.example.com",
    instance: "bot-whatsap",
    apiKey: "secret-key",
  });

  assert.throws(
    () => evolutionSettings(
      { ...integration, config: { baseUrl: "http://evo.example.com", instance: "bot" } },
      "production",
    ),
    EvolutionSettingsError,
  );
  assert.equal(
    evolutionSettings(
      { ...integration, config: { baseUrl: "http://evo.example.com", instance: "bot" } },
      "test",
    ).baseUrl,
    "http://evo.example.com",
  );
  for (const config of [
    { instance: "bot-whatsap" },
    { baseUrl: "https://evo.example.com" },
    { baseUrl: "not-a-url", instance: "bot-whatsap" },
    { baseUrl: "https://evo.example.com", instance: "bad instance" },
  ]) {
    assert.throws(
      () => evolutionSettings({ ...integration, config }, "test"),
      EvolutionSettingsError,
    );
  }
  assert.throws(
    () => evolutionSettings({ ...integration, credentials: {} }, "test"),
    EvolutionSettingsError,
  );
});

test("the Evolution adapter enforces the tenant and the provider key", async () => {
  const client = {
    calls: 0,
    async sendText(): Promise<string | null> {
      this.calls += 1;
      return "3EB0SENT";
    },
  };
  const integrations = new FakeIntegrations();
  const adapter = new EvolutionAdapter(integrations, client, "test");

  const sent = await adapter.sendText({
    businessId: businessA,
    integrationId,
    to: "56911112222",
    text: "Hola",
  });
  assert.equal(sent.externalMessageId, "3EB0SENT");
  assert.equal(client.calls, 1);

  await assert.rejects(
    adapter.sendText({
      businessId: businessB,
      integrationId,
      to: "56911112222",
      text: "Hola",
    }),
    (error: unknown) => error instanceof WhatsappProviderError &&
      error.providerErrorCode === "evolution_integration_not_found",
  );
  assert.equal(client.calls, 1);
});

test("the Evolution adapter maps settings and client failures to safe codes", async () => {
  const integrations = new FakeIntegrations();
  integrations.integration = {
    id: integrationId,
    businessId: businessA,
    providerKey: "evolution",
    config: { baseUrl: "http://evo.example.com", instance: "bot-whatsap" },
    credentials: { apiKey: "secret-key" },
  };
  const failing = {
    async sendText(): Promise<string | null> {
      throw new EvolutionRequestRejectedError();
    },
  };
  const productionAdapter = new EvolutionAdapter(integrations, failing, "production");
  await assert.rejects(
    productionAdapter.sendText({
      businessId: businessA, integrationId, to: "56911112222", text: "Hola",
    }),
    (error: unknown) => error instanceof WhatsappProviderError &&
      error.providerErrorCode === "evolution_settings_invalid",
  );

  const testAdapter = new EvolutionAdapter(integrations, failing, "test");
  await assert.rejects(
    testAdapter.sendText({
      businessId: businessA, integrationId, to: "56911112222", text: "Hola",
    }),
    (error: unknown) => error instanceof WhatsappProviderError &&
      error.providerErrorCode === "evolution_request_rejected",
  );
});
