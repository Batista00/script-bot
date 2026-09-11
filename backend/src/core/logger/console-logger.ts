import type { Env } from "../../config/env.js";
import type { JobLogger } from "../../modules/jobs/jobs.types.js";

const levelWeight: Record<Env["LOG_LEVEL"], number> = {
  fatal: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5, silent: 6,
};

type LogMethod = "info" | "warn" | "error";

/**
 * Structured JSON logger for background processes. Fastify owns its own logger
 * for the HTTP server; workers need the same shape without pulling in a
 * logging framework, and must never print credentials or payloads.
 */
export function createConsoleLogger(level: Env["LOG_LEVEL"]): JobLogger {
  const threshold = levelWeight[level];
  const write = (method: LogMethod, details: Record<string, unknown>, message: string): void => {
    if (levelWeight[method] < threshold || level === "silent") return;
    const line = JSON.stringify({
      level: method === "warn" ? "warn" : method,
      time: new Date().toISOString(),
      component: "worker",
      msg: message,
      ...details,
    });
    if (method === "error") process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  };
  return {
    info: (details, message) => write("info", details, message),
    warn: (details, message) => write("warn", details, message),
    error: (details, message) => write("error", details, message),
  };
}
