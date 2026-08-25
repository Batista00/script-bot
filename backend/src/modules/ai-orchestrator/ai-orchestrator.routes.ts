import type { FastifyPluginAsync } from "fastify";

import { requireMachineCredential } from "../machine-auth/machine-auth.middleware.js";
import type { MachineAuthService } from "../machine-auth/machine-auth.service.js";

import { AiOrchestratorController } from "./ai-orchestrator.controller.js";
import { aiAssistantMessageSchema } from "./ai-orchestrator.schema.js";
import { AiOrchestratorService } from "./ai-orchestrator.service.js";
import type { AiAssistantRequest } from "./ai-orchestrator.types.js";

interface AiOrchestratorRoutesOptions {
  service: AiOrchestratorService;
  machineAuth: MachineAuthService;
}

export const aiOrchestratorRoutes:
FastifyPluginAsync<AiOrchestratorRoutesOptions> = async (
  app,
  options,
) => {
  app.decorateRequest("machineAuthContext", null);

  const controller = new AiOrchestratorController(options.service);
  const machineAuth = requireMachineCredential(options.machineAuth);

  app.post<{ Body: AiAssistantRequest }>(
    "/message",
    {
      schema: aiAssistantMessageSchema,
      preHandler: machineAuth,
    },
    controller.message,
  );
};
