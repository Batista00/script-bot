import type { preHandlerHookHandler } from "fastify";

import { AppError } from "../errors/app-error.js";

export interface FixedWindowRateLimitOptions {
  max: number;
  windowSeconds: number;
  now?: () => number;
}

export interface RateLimitDecision {
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
export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, WindowBucket>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private lastSweepAt: number;

  constructor(options: FixedWindowRateLimitOptions) {
    assertPositiveInteger(options.max, "Rate limit max");
    assertPositiveInteger(options.windowSeconds, "Rate limit windowSeconds");
    this.max = options.max;
    this.windowMs = options.windowSeconds * 1_000;
    this.now = options.now ?? Date.now;
    this.lastSweepAt = this.now();
  }

  consume(key: string): RateLimitDecision {
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

export interface RateLimitGuardOptions {
  limiter: FixedWindowRateLimiter;
  /** Derives the bucket key from the request (client IP, credential id, ...). */
  key: (request: Parameters<preHandlerHookHandler>[0]) => string;
  code: string;
  message: string;
}

/**
 * Applies a limiter to a route. The `Retry-After` header is set before the
 * error is thrown so the standard error handler keeps it.
 */
export function rateLimitGuard(options: RateLimitGuardOptions): preHandlerHookHandler {
  return async (request, reply) => {
    const decision = options.limiter.consume(options.key(request));
    if (decision.allowed) return;
    reply.header("Retry-After", String(decision.retryAfterSeconds));
    throw new AppError(options.message, 429, options.code);
  };
}
