import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";

import {
  requireAuthenticatedUser,
  requireBusinessMembership,
  requireBusinessRole,
} from "../auth/auth.middleware.js";
import { requireActiveBusiness } from "../businesses/businesses.active.middleware.js";
import {
  type ConversationBusinessParams,
  type ConversationIdParams,
  type EvolutionWebhookHeaders,
  type EvolutionWebhookParams,
  WhatsappController,
} from "./whatsapp.controller.js";
import {
  evolutionWebhookSchema,
  listConversationMessagesSchema,
  listConversationsSchema,
  sendConversationMessageSchema,
  updateConversationSchema,
} from "./whatsapp.schema.js";
import { WhatsappService } from "./whatsapp.service.js";
import type {
  ConversationListQuery,
  ConversationMessageListQuery,
  SendConversationMessageInput,
  UpdateConversationInput,
} from "./whatsapp.types.js";
import { WhatsappWebhookService } from "./whatsapp.webhook.service.js";

interface WhatsappRoutesOptions {
  service: WhatsappService;
  webhookService: WhatsappWebhookService;
  /** Public endpoint: anonymous floods are throttled per client address. */
  rateLimit?: preHandlerHookHandler;
}

export const whatsappRoutes: FastifyPluginAsync<WhatsappRoutesOptions> = async (
  app,
  options,
) => {
  const controller = new WhatsappController(options.service, options.webhookService);
  const authorization = [
    requireAuthenticatedUser(app.authService),
    requireBusinessMembership(app.membershipsRepository),
    requireBusinessRole(["owner", "admin", "operator"]),
  ];
  const activeBusiness = requireActiveBusiness();
  const writeAuthorization = [...authorization, activeBusiness];

  // Public Evolution ingress: authenticated by the shared secret header, not
  // by a session. It is throttled with the existing public webhook limiter.
  app.post<{
    Params: EvolutionWebhookParams;
    Headers: EvolutionWebhookHeaders;
    Body: unknown;
  }>(
    "/webhooks/evolution/:integrationId",
    {
      schema: evolutionWebhookSchema,
      ...(options.rateLimit === undefined ? {} : { preHandler: options.rateLimit }),
    },
    controller.processWebhook,
  );

  app.get<{ Params: ConversationBusinessParams; Querystring: ConversationListQuery }>(
    "/businesses/:businessId/conversations",
    { schema: listConversationsSchema, preHandler: authorization },
    controller.listConversations,
  );
  app.get<{ Params: ConversationIdParams; Querystring: ConversationMessageListQuery }>(
    "/businesses/:businessId/conversations/:conversationId/messages",
    { schema: listConversationMessagesSchema, preHandler: authorization },
    controller.listMessages,
  );
  app.patch<{ Params: ConversationIdParams; Body: UpdateConversationInput }>(
    "/businesses/:businessId/conversations/:conversationId",
    { schema: updateConversationSchema, preHandler: writeAuthorization },
    controller.updateConversation,
  );
  app.post<{ Params: ConversationIdParams; Body: SendConversationMessageInput }>(
    "/businesses/:businessId/conversations/:conversationId/messages",
    { schema: sendConversationMessageSchema, preHandler: writeAuthorization },
    controller.sendMessage,
  );
};
