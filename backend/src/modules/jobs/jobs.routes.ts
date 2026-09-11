import type { FastifyPluginAsync } from "fastify";

import {
  requireAuthenticatedUser,
  requireBusinessMembership,
  requireBusinessRole,
} from "../auth/auth.middleware.js";
import {
  type JobBusinessParams,
  JobsController,
  type JobItemParams,
  type JobListQuery,
} from "./jobs.controller.js";
import { listJobsSchema, retryJobSchema } from "./jobs.schema.js";
import { JobsService } from "./jobs.service.js";

interface JobsRoutesOptions { service: JobsService }

export const jobsRoutes: FastifyPluginAsync<JobsRoutesOptions> = async (app, options) => {
  const controller = new JobsController(options.service);
  const read = [
    requireAuthenticatedUser(app.authService),
    requireBusinessMembership(app.membershipsRepository),
    requireBusinessRole(["owner", "admin", "operator"]),
  ];
  const write = [
    requireAuthenticatedUser(app.authService),
    requireBusinessMembership(app.membershipsRepository),
    requireBusinessRole(["owner", "admin"]),
  ];

  app.get<{ Params: JobBusinessParams; Querystring: JobListQuery }>(
    "/businesses/:businessId/jobs",
    { schema: listJobsSchema, preHandler: read },
    controller.list,
  );
  app.post<{ Params: JobItemParams }>(
    "/businesses/:businessId/jobs/:jobId/retry",
    { schema: retryJobSchema, preHandler: write },
    controller.retry,
  );
};
