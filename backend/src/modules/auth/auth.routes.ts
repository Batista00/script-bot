import type { FastifyPluginAsync } from "fastify";

import type { Env } from "../../config/env.js";
import { AuthController } from "./auth.controller.js";
import { requireAuthenticatedUser } from "./auth.middleware.js";
import { loginSchema, logoutSchema, meSchema } from "./auth.schema.js";
import type { LoginInput } from "./auth.types.js";

interface AuthRoutesOptions {
  config: Pick<Env, "NODE_ENV">;
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, options) => {
  const controller = new AuthController(app.authService, options.config.NODE_ENV);
  const requireUser = requireAuthenticatedUser(app.authService);

  app.post<{ Body: LoginInput }>("/login", { schema: loginSchema }, controller.login);
  app.post(
    "/logout",
    { schema: logoutSchema, preHandler: requireUser },
    controller.logout,
  );
  app.get("/me", { schema: meSchema, preHandler: requireUser }, controller.me);
};

