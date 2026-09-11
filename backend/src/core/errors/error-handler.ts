import type { FastifyInstance } from "fastify";

import { AppError } from "./app-error.js";

interface FastifyErrorLike {
  statusCode?: unknown;
  validation?: unknown;
}

function clientErrorCode(statusCode: number): string {
  switch (statusCode) {
    case 404: return "NOT_FOUND";
    case 413: return "PAYLOAD_TOO_LARGE";
    case 415: return "UNSUPPORTED_MEDIA_TYPE";
    case 429: return "TOO_MANY_REQUESTS";
    default: return "INVALID_REQUEST";
  }
}

function clientErrorMessage(statusCode: number): string {
  switch (statusCode) {
    case 404: return "Route not found";
    case 413: return "Request payload is too large";
    case 415: return "Unsupported media type";
    case 429: return "Too many requests";
    default: return "Request validation failed";
  }
}

function isValidationError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    Array.isArray((error as FastifyErrorLike).validation)
  );
}

export function registerErrorHandler(app: FastifyInstance): void {
  // Unknown routes answer with the same error envelope as the rest of the API.
  app.setNotFoundHandler((_request, reply) => reply.status(404).send({
    error: { code: "NOT_FOUND", message: "Route not found" },
  }));

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      // 5xx application errors are unexpected and must be observable.
      if (error.statusCode >= 500) {
        request.log.error({ err: error }, "Application error");
      }
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (isValidationError(error)) {
      return reply.status(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: "Request validation failed",
        },
      });
    }

    // Fastify raises client errors with their own status (body too large,
    // unsupported media type, malformed JSON, ...). Honour the status instead
    // of turning a client mistake into an internal error.
    const statusCode = (error as FastifyErrorLike).statusCode;
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
      request.log.warn({ err: error }, "Client request rejected");
      return reply.status(statusCode).send({
        error: {
          code: clientErrorCode(statusCode),
          message: clientErrorMessage(statusCode),
        },
      });
    }

    request.log.error({ err: error }, "Unhandled request error");
    return reply.status(500).send({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Internal server error",
      },
    });
  });
}
