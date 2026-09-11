import type { preHandlerHookHandler } from "fastify";

import {
  FixedWindowRateLimiter,
  rateLimitGuard,
  type FixedWindowRateLimitOptions,
  type RateLimitDecision,
} from "../../core/rate-limit/fixed-window-rate-limiter.js";

export const loginRateLimitDefaults = {
  max: 10,
  windowSeconds: 900,
} as const;

export type LoginRateLimitOptions = FixedWindowRateLimitOptions;
export type LoginRateLimitDecision = RateLimitDecision;
export type LoginRateLimiter = FixedWindowRateLimiter;
export const LoginRateLimiter = FixedWindowRateLimiter;

/**
 * Rate limit applied only to `POST /auth/login`, keyed by client address. The
 * address respects `TRUST_PROXY`, so behind the documented Nginx it is the real
 * visitor instead of the proxy.
 */
export function loginRateLimitGuard(limiter: FixedWindowRateLimiter): preHandlerHookHandler {
  return rateLimitGuard({
    limiter,
    key: (request) => (request.ip.length > 0 ? request.ip : "unknown"),
    code: "TOO_MANY_LOGIN_ATTEMPTS",
    message: "Too many login attempts. Try again later.",
  });
}
