import assert from "node:assert/strict";
import { test } from "node:test";

import { runner } from "node-pg-migrate";

import { buildApp } from "../../src/app.js";
import type { Env } from "../../src/config/env.js";
import { createDatabasePool } from "../../src/core/database/database.js";
import { hashPassword } from "../../src/modules/auth/auth.crypto.js";
import { PostgresBusinessesRepository } from "../../src/modules/businesses/businesses.repository.js";
import { IntegrationCredentialsCrypto } from "../../src/modules/integrations/integrations.crypto.js";
import { PostgresIntegrationsRepository } from "../../src/modules/integrations/integrations.repository.js";
import { IntegrationsService } from "../../src/modules/integrations/integrations.service.js";
import { PostgresWhatsappRepository } from "../../src/modules/whatsapp/whatsapp.repository.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const encryptionKey = Buffer.alloc(32, 27).toString("base64");

interface InboundOptions {
  remoteJid?: string;
  messageId?: string;
  pushName?: string;
  text?: string;
  imageUrl?: string;
}

function inboundPayload(options: InboundOptions = {}): Record<string, unknown> {
  const remoteJid = options.remoteJid ?? "56911112222@s.whatsapp.net";
  const messageId = options.messageId ?? "MSG-A-1";
  const pushName = options.pushName ?? "Ana Pérez";
  const text = options.text ?? "Hola";
  return {
    event: "messages.upsert",
    instance: "integration-test",
    data: {
      key: { remoteJid, fromMe: false, id: messageId },
      pushName,
      messageType: options.imageUrl === undefined ? "conversation" : "imageMessage",
      message: options.imageUrl === undefined
        ? { conversation: text }
        : { imageMessage: { mimetype: "image/jpeg", url: options.imageUrl } },
    },
  };
}

function sessionCookie(setCookie: string | string[] | undefined): string {
  const serialized = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert.ok(serialized);
  return serialized.split(";", 1)[0] ?? "";
}

test(
  "Evolution inbound webhook and conversation reads against PostgreSQL",
  { skip: testDatabaseUrl ? false : "TEST_DATABASE_URL is not configured" },
  async (t) => {
    if (!testDatabaseUrl) return;
    await runner({
      databaseUrl: testDatabaseUrl,
      direction: "up",
      dir: "migrations",
      migrationsTable: "pgmigrations",
      count: Infinity,
      log: () => undefined,
    });
    const config: Env = {
      NODE_ENV: "test",
      PORT: 3_000,
      DATABASE_URL: testDatabaseUrl,
      LOG_LEVEL: "silent",
      AUTH_SESSION_TTL_HOURS: 168,
      INTEGRATIONS_ENCRYPTION_KEY: encryptionKey,
    };
    const app = await buildApp(config);
    const db = createDatabasePool(testDatabaseUrl);
    const businesses = new PostgresBusinessesRepository(db);
    const integrations = new IntegrationsService(
      new PostgresIntegrationsRepository(db),
      new IntegrationCredentialsCrypto(encryptionKey),
    );
    const repository = new PostgresWhatsappRepository(app.db);
    const businessIds: string[] = [];
    const emails: string[] = [];
    t.after(async () => {
      for (const businessId of businessIds) {
        await db.query("DELETE FROM businesses WHERE id = $1", [businessId]);
      }
      if (emails.length > 0) {
        await db.query("DELETE FROM users WHERE lower(email) = ANY($1::text[])", [
          emails.map((email) => email.toLowerCase()),
        ]);
      }
      await app.close();
      await db.end();
    });

    const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const businessA = await businesses.create(`WhatsApp A ${unique}`);
    const businessB = await businesses.create(`WhatsApp B ${unique}`);
    businessIds.push(businessA.id, businessB.id);
    const webhookSecretA = `webhook-secret-a-${unique}`;
    const webhookSecretB = `webhook-secret-b-${unique}`;
    const integrationA = await integrations.create(businessA.id, {
      providerKey: "evolution",
      config: { baseUrl: "http://127.0.0.1:9099", instance: `inst-a-${unique}` },
      credentials: { apiKey: `api-key-a-${unique}`, webhookSecret: webhookSecretA },
    });
    const integrationB = await integrations.create(businessB.id, {
      providerKey: "evolution",
      config: { baseUrl: "http://127.0.0.1:9099", instance: `inst-b-${unique}` },
      credentials: { apiKey: `api-key-b-${unique}`, webhookSecret: webhookSecretB },
    });

    // --- Inbound ingestion, normalization and idempotency -------------------
    const first = await app.inject({
      method: "POST",
      url: `/webhooks/evolution/${integrationA.id}`,
      headers: { "x-webhook-secret": webhookSecretA },
      payload: inboundPayload({ messageId: "MSG-A-1", text: "Hola" }),
    });
    assert.equal(first.statusCode, 200, JSON.stringify(first.json()));
    const context = first.json();
    assert.equal(context.duplicate, false);
    assert.equal(context.isNewConversation, true);
    assert.equal(context.phone, "56911112222");
    assert.equal(context.name, "Ana Pérez");
    assert.equal(context.text, "Hola");
    assert.equal(context.mediaType, null);
    assert.ok(context.conversationId);
    assert.ok(context.customerId);

    const conversation = await db.query<{
      id: string;
      customer_id: string;
      external_thread_id: string | null;
      status: string;
      unread_count: number;
    }>(
      `SELECT id, customer_id, external_thread_id, status::text AS status, unread_count
       FROM conversations WHERE business_id = $1`,
      [businessA.id],
    );
    assert.equal(conversation.rows.length, 1);
    assert.equal(conversation.rows[0]?.id, context.conversationId);
    assert.equal(conversation.rows[0]?.customer_id, context.customerId);
    assert.equal(conversation.rows[0]?.external_thread_id, "56911112222@s.whatsapp.net");
    assert.equal(conversation.rows[0]?.status, "open");
    assert.equal(conversation.rows[0]?.unread_count, 1);

    const customer = await db.query<{ id: string; phone: string | null; name: string | null }>(
      "SELECT id, phone, name FROM customers WHERE business_id = $1",
      [businessA.id],
    );
    assert.equal(customer.rows.length, 1);
    assert.equal(customer.rows[0]?.id, context.customerId);
    assert.equal(customer.rows[0]?.phone, "56911112222");
    assert.equal(customer.rows[0]?.name, "Ana Pérez");

    const retry = await app.inject({
      method: "POST",
      url: `/webhooks/evolution/${integrationA.id}`,
      headers: { "x-webhook-secret": webhookSecretA },
      payload: inboundPayload({ messageId: "MSG-A-1", text: "Hola" }),
    });
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.json().duplicate, true);
    assert.equal(retry.json().isNewConversation, false);
    assert.equal(retry.json().conversationId, context.conversationId);
    const afterRetry = await db.query<{ count: number; unread_count: number }>(
      `SELECT (SELECT count(*)::integer FROM conversation_messages WHERE business_id = $1) AS count,
              (SELECT unread_count FROM conversations WHERE business_id = $1) AS unread_count`,
      [businessA.id],
    );
    assert.equal(afterRetry.rows[0]?.count, 1);
    assert.equal(afterRetry.rows[0]?.unread_count, 1);

    const secondMessage = await app.inject({
      method: "POST",
      url: `/webhooks/evolution/${integrationA.id}`,
      headers: { "x-webhook-secret": webhookSecretA },
      payload: inboundPayload({ messageId: "MSG-A-2", text: "¿Cuánto cuesta?" }),
    });
    assert.equal(secondMessage.statusCode, 200);
    assert.equal(secondMessage.json().duplicate, false);
    assert.equal(secondMessage.json().isNewConversation, false);
    assert.equal(secondMessage.json().conversationId, context.conversationId);

    const mediaMessage = await app.inject({
      method: "POST",
      url: `/webhooks/evolution/${integrationA.id}`,
      headers: { "x-webhook-secret": webhookSecretA },
      payload: inboundPayload({
        remoteJid: "56911112222@s.whatsapp.net",
        messageId: "MSG-A-3",
        imageUrl: "https://cdn.example.com/receipt.jpg",
      }),
    });
    assert.equal(mediaMessage.statusCode, 200);
    assert.equal(mediaMessage.json().conversationId, context.conversationId);
    assert.equal(mediaMessage.json().mediaType, "image");
    assert.equal(mediaMessage.json().mediaUrl, "https://cdn.example.com/receipt.jpg");

    const mediaRow = await db.query<{ media_type: string | null; media_url: string | null }>(
      `SELECT media_type, media_url FROM conversation_messages
       WHERE business_id = $1 AND external_message_id = 'MSG-A-3'`,
      [businessA.id],
    );
    assert.equal(mediaRow.rows[0]?.media_type, "image");
    assert.equal(mediaRow.rows[0]?.media_url, "https://cdn.example.com/receipt.jpg");

    // --- Public webhook guards ---------------------------------------------
    const wrongSecret = await app.inject({
      method: "POST",
      url: `/webhooks/evolution/${integrationA.id}`,
      headers: { "x-webhook-secret": webhookSecretB },
      payload: inboundPayload({ messageId: "MSG-A-4" }),
    });
    assert.equal(wrongSecret.statusCode, 401);
    assert.equal(wrongSecret.json().error.code, "INVALID_WEBHOOK_SECRET");

    const unknownIntegration = await app.inject({
      method: "POST",
      url: "/webhooks/evolution/11111111-1111-4111-8111-111111111111",
      headers: { "x-webhook-secret": webhookSecretA },
      payload: inboundPayload({ messageId: "MSG-A-5" }),
    });
    assert.equal(unknownIntegration.statusCode, 404);
    assert.equal(unknownIntegration.json().error.code, "INTEGRATION_NOT_FOUND");

    const invalidBody = await app.inject({
      method: "POST",
      url: `/webhooks/evolution/${integrationA.id}`,
      headers: { "x-webhook-secret": webhookSecretA },
      payload: {},
    });
    assert.equal(invalidBody.statusCode, 400);

    const ignored = await app.inject({
      method: "POST",
      url: `/webhooks/evolution/${integrationA.id}`,
      headers: { "x-webhook-secret": webhookSecretA },
      payload: {
        event: "messages.upsert",
        instance: "integration-test",
        data: {
          key: { remoteJid: "56911112222@s.whatsapp.net", fromMe: true, id: "MSG-A-6" },
          messageType: "conversation",
          message: { conversation: "Lo envié yo" },
        },
      },
    });
    assert.equal(ignored.statusCode, 200);
    assert.deepEqual(ignored.json(), { ignored: true });

    // --- Second business and cross-tenant isolation -------------------------
    const businessBMessage = await app.inject({
      method: "POST",
      url: `/webhooks/evolution/${integrationB.id}`,
      headers: { "x-webhook-secret": webhookSecretB },
      payload: inboundPayload({
        remoteJid: "56999998888@c.us",
        messageId: "MSG-B-1",
        pushName: "Beto",
        text: "Hola desde B",
      }),
    });
    assert.equal(businessBMessage.statusCode, 200);
    assert.equal(businessBMessage.json().isNewConversation, true);

    assert.equal(
      await repository.findConversationById(businessB.id, context.conversationId),
      null,
    );
    assert.equal(
      (await repository.listMessages(businessB.id, context.conversationId, {
        limit: 50,
        offset: 0,
      })).length,
      0,
    );
    const businessBConversations = await repository.listConversations(businessB.id, {
      limit: 50,
      offset: 0,
    });
    assert.equal(businessBConversations.length, 1);
    assert.notEqual(businessBConversations[0]?.id, context.conversationId);

    // --- Authenticated reads and human handoff ------------------------------
    const password = "integration-password";
    const emailA = `whatsapp-a-${unique}@example.com`;
    const emailB = `whatsapp-b-${unique}@example.com`;
    emails.push(emailA, emailB);
    const passwordHash = await hashPassword(password);
    const userA = await db.query<{ id: string }>(
      "INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id",
      [emailA, "WhatsApp Owner A", passwordHash],
    );
    const userB = await db.query<{ id: string }>(
      "INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id",
      [emailB, "WhatsApp Owner B", passwordHash],
    );
    const userIdA = userA.rows[0]?.id;
    const userIdB = userB.rows[0]?.id;
    assert.ok(userIdA);
    assert.ok(userIdB);
    await db.query(
      "INSERT INTO business_memberships (business_id, user_id, role) VALUES ($1, $2, 'owner')",
      [businessA.id, userIdA],
    );
    await db.query(
      "INSERT INTO business_memberships (business_id, user_id, role) VALUES ($1, $2, 'owner')",
      [businessB.id, userIdB],
    );
    const loginA = await app.inject({
      method: "POST", url: "/auth/login", payload: { email: emailA, password },
    });
    assert.equal(loginA.statusCode, 200, JSON.stringify(loginA.json()));
    const cookieA = sessionCookie(loginA.headers["set-cookie"]);
    const loginB = await app.inject({
      method: "POST", url: "/auth/login", payload: { email: emailB, password },
    });
    assert.equal(loginB.statusCode, 200);
    const cookieB = sessionCookie(loginB.headers["set-cookie"]);

    const listA = await app.inject({
      method: "GET",
      url: `/businesses/${businessA.id}/conversations`,
      headers: { cookie: cookieA },
    });
    assert.equal(listA.statusCode, 200, JSON.stringify(listA.json()));
    assert.equal(listA.json().length, 1);
    assert.equal(listA.json()[0].id, context.conversationId);
    assert.equal(listA.json()[0].customerId, context.customerId);
    assert.equal(listA.json()[0].channel, "whatsapp");
    assert.equal("externalThreadId" in listA.json()[0], false);
    assert.equal("external_thread_id" in listA.json()[0], false);

    const listB = await app.inject({
      method: "GET",
      url: `/businesses/${businessB.id}/conversations`,
      headers: { cookie: cookieB },
    });
    assert.equal(listB.statusCode, 200);
    assert.equal(listB.json().length, 1);
    assert.notEqual(listB.json()[0].id, context.conversationId);

    const messagesA = await app.inject({
      method: "GET",
      url: `/businesses/${businessA.id}/conversations/${context.conversationId}/messages`,
      headers: { cookie: cookieA },
    });
    assert.equal(messagesA.statusCode, 200);
    assert.equal(messagesA.json().length, 3);
    const bodies = messagesA.json().map((message: { body: string | null }) => message.body);
    assert.ok(bodies.includes("Hola"));
    assert.ok(bodies.includes("¿Cuánto cuesta?"));

    const foreignRead = await app.inject({
      method: "GET",
      url: `/businesses/${businessA.id}/conversations/${context.conversationId}/messages`,
      headers: { cookie: cookieB },
    });
    assert.equal(foreignRead.statusCode, 404);
    assert.equal(foreignRead.json().error.code, "BUSINESS_NOT_FOUND");

    const handoff = await app.inject({
      method: "PATCH",
      url: `/businesses/${businessA.id}/conversations/${context.conversationId}`,
      headers: { cookie: cookieA },
      payload: { status: "human" },
    });
    assert.equal(handoff.statusCode, 200);
    assert.equal(handoff.json().status, "human");

    const openList = await app.inject({
      method: "GET",
      url: `/businesses/${businessA.id}/conversations?status=open`,
      headers: { cookie: cookieA },
    });
    assert.equal(openList.statusCode, 200);
    assert.equal(openList.json().length, 0);
    const humanList = await app.inject({
      method: "GET",
      url: `/businesses/${businessA.id}/conversations?status=human&limit=10&offset=0`,
      headers: { cookie: cookieA },
    });
    assert.equal(humanList.statusCode, 200);
    assert.equal(humanList.json().length, 1);

    const foreignHandoff = await app.inject({
      method: "PATCH",
      url: `/businesses/${businessA.id}/conversations/${context.conversationId}`,
      headers: { cookie: cookieB },
      payload: { status: "closed" },
    });
    assert.equal(foreignHandoff.statusCode, 404);

    const unauthenticated = await app.inject({
      method: "GET",
      url: `/businesses/${businessA.id}/conversations`,
    });
    assert.equal(unauthenticated.statusCode, 401);
  },
);
