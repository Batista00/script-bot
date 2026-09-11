import type { FastifyPluginAsync } from "fastify";

import { requireActiveBusiness } from "../businesses/businesses.active.middleware.js";
import { requireMachineCredential } from "../machine-auth/machine-auth.middleware.js";
import type { MachineAuthService } from "../machine-auth/machine-auth.service.js";
import { ConversationController } from "./conversation.controller.js";
import { conversationTurnSchema } from "./conversation.schema.js";
import type { ConversationService } from "./conversation.service.js";

export interface ConversationRoutesOptions {
  service: ConversationService;
  machineAuth: MachineAuthService;
}

/**
 * Punto de entrada conversacional. Typebot llama exactamente aquí en cada
 * turno: recibe el texto o el `id` del botón pulsado y devuelve el mensaje ya
 * renderizado (con botones nativos cuando corresponde).
 */
export const conversationRoutes: FastifyPluginAsync<ConversationRoutesOptions> = async (
  app,
  { service, machineAuth },
) => {
  const controller = new ConversationController(service);
  app.post(
    "/conversation/turn",
    {
      schema: conversationTurnSchema,
      preHandler: [requireMachineCredential(machineAuth), requireActiveBusiness()],
    },
    controller.turn,
  );
};
