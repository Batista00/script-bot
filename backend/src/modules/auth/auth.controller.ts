import type { FastifyReply, FastifyRequest } from "fastify";

import type { Env } from "../../config/env.js";
import { AppError } from "../../core/errors/app-error.js";
import {
  sessionCookieName,
  sessionCookieOptions,
} from "./auth.cookie.js";
import type { AuthService } from "./auth.service.js";
import type { LoginInput } from "./auth.types.js";

export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly nodeEnvironment: Env["NODE_ENV"],
  ) {}

  login = async (
    request: FastifyRequest<{ Body: LoginInput }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const { sessionToken, expiresAt, ...view } = await this.service.login(request.body);
    reply.setCookie(
      sessionCookieName,
      sessionToken,
      sessionCookieOptions(this.nodeEnvironment === "production", expiresAt),
    );
    return reply.status(200).send(view);
  };

  me = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    if (!request.authenticatedUser) {
      throw new AppError("Authentication required", 401, "AUTHENTICATION_REQUIRED");
    }

    return reply.status(200).send(await this.service.getView(request.authenticatedUser));
  };

  logout = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    await this.service.logout(request.cookies[sessionCookieName]);
    reply.clearCookie(
      sessionCookieName,
      sessionCookieOptions(this.nodeEnvironment === "production"),
    );
    return reply.status(204).send();
  };
}

