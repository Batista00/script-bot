import type { FastifyReply, FastifyRequest } from "fastify";

import { requireMachineContext } from "../machine-auth/machine-auth.fastify.js";
import type { ConversationService } from "./conversation.service.js";
import type { ConversationTurnInput } from "./conversation.types.js";

export class ConversationController {
  constructor(private readonly service: ConversationService) {}
  private business(request: FastifyRequest): string {
    return requireMachineContext(request.machineAuthContext).businessId;
  }
  turn = async (request: FastifyRequest, reply: FastifyReply) =>
    reply.status(200).send(await this.service.handleTurn(
      this.business(request),
      request.body as ConversationTurnInput,
    ));
}
