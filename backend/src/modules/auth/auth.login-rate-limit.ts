import type { FastifyRequest, preHandlerHookHandler } from "fastify";

import { AppError } from "../../core/errors/app-error.js";

export const loginRateLimitDefaults = {
  max: 10,
  windowSeconds: 900,
} as const;

export interface LoginRateLimitOptions {
  max: number;
  windowSeconds: number;
  now?: () => number;
}

export interface LoginRateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface WindowBucket {
  count: number;
  resetAt: number;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

/**
 * Fixed-window counter kept in memory. Adequate for the single-replica
 * deployment documented in deploy/README.md; a shared store would be required
 * before scaling the backend horizontally.
 */
export class LoginRateLimiter {
  private readonly buckets = new Map<string, WindowBucket>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private lastSweepAt: number;

  constructor(options: LoginRateLimitOptions) {
    assertPositiveInteger(options.max, "Login rate limit max");
    assertPositiveInteger(options.windowSeconds, "Login rate limit windowSeconds");
    this.max = options.max;
    this.windowMs = options.windowSeconds * 1_000;
    this.now = options.now ?? Date.now;
    this.lastSweepAt = this.now();
  }

  consume(key: string): LoginRateLimitDecision {
    const now = this.now();
    this.sweep(now);
    const bucket = this.buckets.get(key);

    if (bucket === undefined || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.max - 1, retryAfterSeconds: 0 };
    }
    if (bucket.count >= this.max) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
      };
    }
    bucket.count += 1;
    return { allowed: true, remaining: this.max - bucket.count, retryAfterSeconds: 0 };
  }

  private sweep(now: number): void {
    if (now - this.lastSweepAt < this.windowMs) return;
    this.lastSweepAt = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

function clientAddress(request: FastifyRequest): string {
  const address = request.ip;
  return address.length > 0 ? address : "unknown";
}

export function loginRateLimitGuard(limiter: LoginRateLimiter): preHandlerHookHandler {
  return async (request, reply) => {
    const decision = limiter.consume(clientAddress(request));
    if (decision.allowed) return;
    reply.header("Retry-After", String(decision.retryAfterSeconds));
    throw new AppError(
      "Too many login attempts. Try again later.",
      429,
      "TOO_MANY_LOGIN_ATTEMPTS",
    );
  };
}
