import fastifyCookie from "@fastify/cookie";
import fastifyPlugin from "fastify-plugin";

import type { Env } from "../../config/env.js";
import { PostgresMembershipsRepository } from "../memberships/memberships.repository.js";
import type {
  BusinessMembership,
  MembershipsRepository,
} from "../memberships/memberships.types.js";
import { PostgresUsersRepository } from "../users/users.repository.js";
import type { User } from "../users/users.types.js";
import { PostgresAuthSessionsRepository } from "./auth.repository.js";
import { AuthService } from "./auth.service.js";

declare module "fastify" {
  interface FastifyInstance {
    authService: AuthService;
    membershipsRepository: MembershipsRepository;
  }

  interface FastifyRequest {
    authenticatedUser: User | null;
    businessMembership: BusinessMembership | null;
  }
}

interface AuthPluginOptions {
  config: Pick<Env, "AUTH_SESSION_TTL_HOURS">;
}

export const authPlugin = fastifyPlugin<AuthPluginOptions>(
  async (app, options) => {
    await app.register(fastifyCookie);

    const users = new PostgresUsersRepository(app.db);
    const sessions = new PostgresAuthSessionsRepository(app.db);
    const memberships = new PostgresMembershipsRepository(app.db);
    const authService = new AuthService(
      users,
      sessions,
      memberships,
      options.config.AUTH_SESSION_TTL_HOURS,
    );

    app.decorate("authService", authService);
    app.decorate("membershipsRepository", memberships);
    app.decorateRequest("authenticatedUser", null);
    app.decorateRequest("businessMembership", null);
  },
  { name: "auth", dependencies: ["database"] },
);

