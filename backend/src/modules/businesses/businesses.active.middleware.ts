import type { preHandlerHookHandler } from "fastify";

import { AppError } from "../../core/errors/app-error.js";

export function inactiveBusinessError(): AppError {
  return new AppError("Business is not active", 409, "BUSINESS_INACTIVE");
}

/**
 * Rejects commercial operations for a suspended tenant. The status travels
 * denormalized inside the request context loaded by session membership or by
 * machine authentication, so this guard performs no additional I/O and cannot
 * be bypassed by another `businessId` in the request.
 *
 * Administrative routes (business settings, memberships, integrations and API
 * credentials) deliberately do not use it, so an owner can always reactivate
 * or repair the tenant.
 */
export function requireActiveBusiness(): preHandlerHookHandler {
  return async (request) => {
    const status = request.businessMembership?.businessStatus
      ?? request.machineAuthContext?.businessStatus;
    if (status === undefined) {
      throw new AppError("Business not found", 404, "BUSINESS_NOT_FOUND");
    }
    if (status !== "active") throw inactiveBusinessError();
  };
}
