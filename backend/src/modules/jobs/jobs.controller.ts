import type { FastifyReply, FastifyRequest } from "fastify";

import type { JobsService } from "./jobs.service.js";
import type { Job, JobStatus } from "./jobs.types.js";

export interface JobBusinessParams { businessId: string }
export interface JobItemParams { businessId: string; jobId: string }
export interface JobListQuery { limit?: string; offset?: string; status?: JobStatus; jobType?: string }

export interface JobDto {
  jobId: string;
  jobType: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toJobDto(job: Job): JobDto {
  return {
    jobId: job.id,
    jobType: job.jobType,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    runAt: job.runAt,
    lastError: job.lastError,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export class JobsController {
  constructor(private readonly service: JobsService) {}

  list = async (
    request: FastifyRequest<{ Params: JobBusinessParams; Querystring: JobListQuery }>,
    reply: FastifyReply,
  ) => {
    const jobs = await this.service.list({
      limit: request.query.limit === undefined ? 50 : Number(request.query.limit),
      offset: request.query.offset === undefined ? 0 : Number(request.query.offset),
      businessId: request.params.businessId,
      ...(request.query.status === undefined ? {} : { status: request.query.status }),
      ...(request.query.jobType === undefined ? {} : { jobType: request.query.jobType }),
    });
    return reply.status(200).send(jobs.map(toJobDto));
  };

  retry = async (
    request: FastifyRequest<{ Params: JobItemParams }>,
    reply: FastifyReply,
  ) => reply.status(200).send(toJobDto(await this.service.retryForBusiness(
    request.params.businessId,
    request.params.jobId,
  )));
}
