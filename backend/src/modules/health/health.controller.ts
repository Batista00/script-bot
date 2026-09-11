import type { FastifyReply, FastifyRequest } from "fastify";

import type { DatabaseExecutor } from "../../core/database/database.js";

export async function getHealth(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  return reply.status(200).send({ status: "ok" });
}

/**
 * Readiness probe: unlike `/health` (process liveness), it verifies that the
 * database answers, so orchestrators can avoid routing traffic to an instance
 * that cannot serve requests. The connection string is never revealed.
 */
export function createReadinessHandler(db: DatabaseExecutor) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    try {
      await db.query("SELECT 1");
      return reply.status(200).send({ status: "ok", database: "ok" });
    } catch (error) {
      request.log.error({ err: error }, "Readiness check failed");
      return reply.status(503).send({ status: "unavailable", database: "unavailable" });
    }
  };
}
