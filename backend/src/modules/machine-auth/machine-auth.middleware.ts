import type { preHandlerHookHandler } from "fastify";

import { AppError } from "../../core/errors/app-error.js";
import type { MachineAuthService } from "./machine-auth.service.js";

function unauthorized(): AppError {
  return new AppError("Machine authentication required", 401, "MACHINE_AUTHENTICATION_REQUIRED");
}

export function requireMachineCredential(service: MachineAuthService): preHandlerHookHandler {
  return async (request) => {
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string" || authorization.length > 256) throw unauthorized();
    const match = /^Bearer ([^\s]+)$/i.exec(authorization);
    if (!match?.[1]) throw unauthorized();
    const context = await service.authenticate(match[1]);
    if (!context) throw unauthorized();
    request.machineAuthContext = context;
  };
}
