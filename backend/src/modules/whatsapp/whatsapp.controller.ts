import type { FastifyReply, FastifyRequest } from "fastify";

import { WhatsappService } from "./whatsapp.service.js";
import {
  type ConversationListQuery,
  type ConversationMessageListQuery,
  conversationStatuses,
  type ConversationStatus,
  type EvolutionWebhookResult,
  type SendConversationMessageInput,
  type UpdateConversationInput,
} from "./whatsapp.types.js";
import { WhatsappWebhookService } from "./whatsapp.webhook.service.js";

export interface EvolutionWebhookParams {
  integrationId: string;
}

export interface EvolutionWebhookHeaders {
  "x-webhook-secret"?: string;
}

export interface ConversationBusinessParams {
  businessId: string;
}

export interface ConversationIdParams extends ConversationBusinessParams {
  conversationId: string;
}

function conversationStatus(value: string | undefined): ConversationStatus | undefined {
  if (value === undefined) return undefined;
  return conversationStatuses.find((status) => status === value);
}

export class WhatsappController {
  constructor(
    private readonly service: WhatsappService,
    private readonly webhookService: WhatsappWebhookService,
  ) {}

  processWebhook = async (
    request: FastifyRequest<{
      Params: EvolutionWebhookParams;
      Headers: EvolutionWebhookHeaders;
      Body: unknown;
    }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const result: EvolutionWebhookResult = await this.webhookService.process({
      integrationId: request.params.integrationId,
      webhookSecret: request.headers["x-webhook-secret"],
      payload: request.body,
    });
    return reply.status(200).send(result);
  };

  listConversations = async (
    request: FastifyRequest<{
      Params: ConversationBusinessParams;
      Querystring: ConversationListQuery;
    }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const status = conversationStatus(request.query.status);
    const conversations = await this.service.listConversations(request.params.businessId, {
      limit: request.query.limit === undefined ? 50 : Number(request.query.limit),
      offset: request.query.offset === undefined ? 0 : Number(request.query.offset),
      ...(status === undefined ? {} : { status }),
    });
    return reply.status(200).send(conversations);
  };

  listMessages = async (
    request: FastifyRequest<{
      Params: ConversationIdParams;
      Querystring: ConversationMessageListQuery;
    }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const messages = await this.service.listMessages(
      request.params.businessId,
      request.params.conversationId,
      {
        limit: request.query.limit === undefined ? 50 : Number(request.query.limit),
        offset: request.query.offset === undefined ? 0 : Number(request.query.offset),
      },
    );
    return reply.status(200).send(messages);
  };

  updateConversation = async (
    request: FastifyRequest<{
      Params: ConversationIdParams;
      Body: UpdateConversationInput;
    }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const conversation = await this.service.updateConversationStatus(
      request.params.businessId,
      request.params.conversationId,
      request.body.status,
    );
    return reply.status(200).send(conversation);
  };

  sendMessage = async (
    request: FastifyRequest<{
      Params: ConversationIdParams;
      Body: SendConversationMessageInput;
    }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const message = await this.service.sendMessage(
      request.params.businessId,
      request.params.conversationId,
      request.body,
    );
    return reply.status(201).send(message);
  };
}
