import type { FastifyReply, FastifyRequest } from "fastify";

import { requireMachineContext } from "../machine-auth/machine-auth.fastify.js";
import { aiAssistantRequestSchemaZod } from "./ai-orchestrator.schema.js";
import { AiOrchestratorService } from "./ai-orchestrator.service.js";
import type { AiAssistantRequest } from "./ai-orchestrator.types.js";

export class AiOrchestratorController {
  constructor(private readonly service: AiOrchestratorService) {}

  message = async (
    request: FastifyRequest<{ Body: AiAssistantRequest }>,
    reply: FastifyReply,
  ) => {
    const businessId = requireMachineContext(
      request.machineAuthContext,
    ).businessId;

    const input = aiAssistantRequestSchemaZod.parse(request.body);

    const result = await this.service.handle(
      businessId,
      input,
    );

    return reply.status(200).send(result);
  };
}
