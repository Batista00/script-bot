import type { MachineAuthContext } from "./machine-auth.types.js";

declare module "fastify" {
  interface FastifyRequest {
    machineAuthContext: MachineAuthContext | null;
  }
}

export function requireMachineContext(context: MachineAuthContext | null): MachineAuthContext {
  if (!context) throw new Error("Machine auth middleware did not set its context");
  return context;
}
