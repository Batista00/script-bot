import type { Env } from "../../config/env.js";

export function createLoggerOptions(logLevel: Env["LOG_LEVEL"]): {
  level: Env["LOG_LEVEL"];
  redact: { paths: string[]; censor: string };
} {
  return {
    level: logLevel,
    redact: {
      paths: ["req.headers.authorization", "req.headers.cookie"],
      censor: "[Redacted]",
    },
  };
}
