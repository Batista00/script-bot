import type { Env } from "../../config/env.js";

export function createLoggerOptions(logLevel: Env["LOG_LEVEL"]): {
  level: Env["LOG_LEVEL"];
} {
  return { level: logLevel };
}

