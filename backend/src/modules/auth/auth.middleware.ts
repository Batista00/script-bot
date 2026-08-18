import type { preHandlerHookHandler } from "fastify";

import { AppError } from "../../core/errors/app-error.js";
import type { MembershipsRepository } from "../memberships/memberships.types.js";
import type { BusinessRole } from "../memberships/memberships.types.js";
import { sessionCookieName } from "./auth.cookie.js";
import type { AuthService } from "./auth.service.js";

export function requireAuthenticatedUser(authService: AuthService): preHandlerHookHandler {
  return async (request) => {
    request.authenticatedUser = await authService.authenticate(
      request.cookies[sessionCookieName],
    );
  };
}

export function requireBusinessMembership(
  memberships: MembershipsRepository,
): preHandlerHookHandler {
  return async (request) => {
    const user = request.authenticatedUser;
    const params = request.params as { id?: unknown };

    if (!user) {
      throw new AppError("Authentication required", 401, "AUTHENTICATION_REQUIRED");
    }
    if (typeof params.id !== "string") {
      throw new AppError("Business not found", 404, "BUSINESS_NOT_FOUND");
    }

    const membership = await memberships.findByBusinessAndUser(params.id, user.id);
    if (!membership) throw new AppError("Business not found", 404, "BUSINESS_NOT_FOUND");
    request.businessMembership = membership;
  };
}

export function requireBusinessRole(allowedRoles: readonly BusinessRole[]): preHandlerHookHandler {
  return async (request) => {
    const membership = request.businessMembership;

    if (!membership || !allowedRoles.includes(membership.role)) {
      throw new AppError("Insufficient business role", 403, "INSUFFICIENT_BUSINESS_ROLE");
    }
  };
}

