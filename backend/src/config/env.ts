import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  DATABASE_URL: z.string().url().refine(
    (value) => value.startsWith("postgres://") || value.startsWith("postgresql://"),
    "DATABASE_URL must use the postgres or postgresql protocol",
  ),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  AUTH_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(24 * 7),
  INTEGRATIONS_ENCRYPTION_KEY: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().regex(
      /^[A-Za-z0-9+/]{43}=$/,
      "INTEGRATIONS_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
    ).optional(),
  ),
  PUBLIC_API_BASE_URL: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().url().refine(
      (value) => value.startsWith("http://") || value.startsWith("https://"),
      "PUBLIC_API_BASE_URL must use the http or https protocol",
    ).optional(),
  ),
  TRUST_PROXY: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().trim().min(1).max(200).optional(),
  ),
  AUTH_LOGIN_RATE_LIMIT_MAX: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.coerce.number().int().min(1).max(10_000).optional(),
  ),
  AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.coerce.number().int().min(1).max(86_400).optional(),
  ),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(input);
}

export type TrustProxyValue = boolean | string;

/**
 * Resolves the Fastify `trustProxy` option. The default trusts loopback only,
 * which matches the documented Nginx reverse proxy on 127.0.0.1 without
 * trusting forwarded headers from any other peer.
 */
export function resolveTrustProxy(value: Env["TRUST_PROXY"]): TrustProxyValue {
  if (value === undefined) return "loopback";
  if (value === "false") return false;
  if (value === "true") return true;
  return value;
}
