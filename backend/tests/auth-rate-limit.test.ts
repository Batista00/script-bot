import assert from "node:assert/strict";
import { test } from "node:test";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import { type Env, loadEnv, resolveTrustProxy } from "../src/config/env.js";
import { AppError } from "../src/core/errors/app-error.js";
import {
  LoginRateLimiter,
  loginRateLimitDefaults,
} from "../src/modules/auth/auth.login-rate-limit.js";
import type { LoginResult } from "../src/modules/auth/auth.types.js";

const testConfig: Env = {
  NODE_ENV: "test",
  PORT: 3_000,
  DATABASE_URL: "postgresql://bot:test@localhost:5432/bot_whatsapp",
  LOG_LEVEL: "silent",
  AUTH_SESSION_TTL_HOURS: 168,
};

const loginBody = { email: "owner@example.com", password: "correct-password" };

function loginResult(): LoginResult {
  return {
    user: {
      id: "46f5476a-c7e9-403f-9fff-fc3bb234c8b6",
      email: "owner@example.com",
      name: "Owner",
      status: "active",
      createdAt: "2026-08-18T12:00:00.000Z",
      updatedAt: "2026-08-18T12:00:00.000Z",
    },
    businesses: [],
    sessionToken: "session-token",
    expiresAt: new Date("2026-08-19T12:00:00.000Z"),
  };
}

function invalidCredentials(): AppError {
  return new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");
}

function stubLogin(
  app: FastifyInstance,
  implementation: () => Promise<LoginResult>,
): void {
  app.authService.login = implementation;
}

function loginRequest(address?: string, forwardedFor?: string) {
  return {
    method: "POST" as const,
    url: "/auth/login",
    payload: loginBody,
    ...(address === undefined ? {} : { remoteAddress: address }),
    ...(forwardedFor === undefined
      ? {}
      : { headers: { "x-forwarded-for": forwardedFor } }),
  };
}

test("login rate limiter allows the configured attempts and blocks the next one", () => {
  let now = 1_000;
  const limiter = new LoginRateLimiter({ max: 3, windowSeconds: 60, now: () => now });

  assert.deepEqual(limiter.consume("client"), {
    allowed: true,
    remaining: 2,
    retryAfterSeconds: 0,
  });
  assert.equal(limiter.consume("client").allowed, true);
  assert.equal(limiter.consume("client").allowed, true);

  const blocked = limiter.consume("client");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfterSeconds >= 1);

  now += 60_000;
  assert.equal(limiter.consume("client").allowed, true);
});

test("login rate limiter isolates buckets per client and expires stale windows", () => {
  let now = 0;
  const limiter = new LoginRateLimiter({ max: 1, windowSeconds: 30, now: () => now });

  assert.equal(limiter.consume("client-a").allowed, true);
  assert.equal(limiter.consume("client-a").allowed, false);
  assert.equal(limiter.consume("client-b").allowed, true);

  now += 30_000;
  assert.equal(limiter.consume("client-a").allowed, true);
});

test("login rate limiter rejects invalid configuration", () => {
  assert.throws(() => new LoginRateLimiter({ max: 0, windowSeconds: 60 }));
  assert.throws(() => new LoginRateLimiter({ max: 10, windowSeconds: 0 }));
  assert.throws(() => new LoginRateLimiter({ max: 1.5, windowSeconds: 60 }));
});

test("login rate limit environment values are optional with safe defaults", () => {
  const base = { DATABASE_URL: "postgresql://bot:test@localhost:5432/bot_whatsapp" };
  const withoutValues = loadEnv(base);
  assert.equal(withoutValues.AUTH_LOGIN_RATE_LIMIT_MAX, undefined);
  assert.equal(withoutValues.AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS, undefined);
  assert.equal(resolveTrustProxy(withoutValues.TRUST_PROXY), "loopback");

  const withValues = loadEnv({
    ...base,
    AUTH_LOGIN_RATE_LIMIT_MAX: "5",
    AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS: "60",
    TRUST_PROXY: "false",
  });
  assert.equal(withValues.AUTH_LOGIN_RATE_LIMIT_MAX, 5);
  assert.equal(withValues.AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS, 60);
  assert.equal(resolveTrustProxy(withValues.TRUST_PROXY), false);
  assert.equal(resolveTrustProxy("true"), true);
  assert.equal(resolveTrustProxy("172.18.0.0/16"), "172.18.0.0/16");
});

test("login rate limit environment values reject invalid input", () => {
  const base = { DATABASE_URL: "postgresql://bot:test@localhost:5432/bot_whatsapp" };
  assert.throws(() => loadEnv({ ...base, AUTH_LOGIN_RATE_LIMIT_MAX: "0" }));
  assert.throws(() => loadEnv({ ...base, AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS: "many" }));
});

test("POST /auth/login still accepts a valid credential", async (t) => {
  const app = await buildApp(testConfig);
  t.after(async () => app.close());
  stubLogin(app, async () => loginResult());

  const response = await app.inject(loginRequest());

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().user.email, "owner@example.com");
  const setCookie = response.headers["set-cookie"];
  assert.match(
    Array.isArray(setCookie) ? setCookie.join(";") : setCookie ?? "",
    /bot_whatsap_session=/,
  );
});

test("POST /auth/login still rejects invalid credentials before any limit", async (t) => {
  const app = await buildApp(testConfig);
  t.after(async () => app.close());
  stubLogin(app, async () => {
    throw invalidCredentials();
  });

  const response = await app.inject(loginRequest());

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), {
    error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" },
  });
});

test("POST /auth/login returns 429 with Retry-After once the limit is exceeded", async (t) => {
  const app = await buildApp({
    ...testConfig,
    AUTH_LOGIN_RATE_LIMIT_MAX: 3,
    AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS: 900,
  });
  t.after(async () => app.close());
  stubLogin(app, async () => {
    throw invalidCredentials();
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal((await app.inject(loginRequest())).statusCode, 401);
  }

  const blocked = await app.inject(loginRequest());

  assert.equal(blocked.statusCode, 429);
  assert.deepEqual(blocked.json(), {
    error: {
      code: "TOO_MANY_LOGIN_ATTEMPTS",
      message: "Too many login attempts. Try again later.",
    },
  });
  assert.ok(Number(blocked.headers["retry-after"]) >= 1);
});

test("login rate limit consumes the safe default when the environment is absent", async (t) => {
  const app = await buildApp(testConfig);
  t.after(async () => app.close());
  stubLogin(app, async () => {
    throw invalidCredentials();
  });

  for (let attempt = 0; attempt < loginRateLimitDefaults.max; attempt += 1) {
    assert.equal((await app.inject(loginRequest())).statusCode, 401);
  }

  assert.equal((await app.inject(loginRequest())).statusCode, 429);
});

test("login rate limit isolates clients and never affects other routes", async (t) => {
  const app = await buildApp({
    ...testConfig,
    AUTH_LOGIN_RATE_LIMIT_MAX: 2,
    AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS: 900,
  });
  t.after(async () => app.close());
  stubLogin(app, async () => {
    throw invalidCredentials();
  });

  assert.equal((await app.inject(loginRequest("203.0.113.10"))).statusCode, 401);
  assert.equal((await app.inject(loginRequest("203.0.113.10"))).statusCode, 401);
  assert.equal((await app.inject(loginRequest("203.0.113.10"))).statusCode, 429);

  assert.equal((await app.inject(loginRequest("203.0.113.11"))).statusCode, 401);

  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);

  const me = await app.inject({
    method: "GET",
    url: "/auth/me",
    remoteAddress: "203.0.113.10",
  });
  assert.equal(me.statusCode, 401);
  assert.equal(me.json().error.code, "AUTHENTICATION_REQUIRED");

  const businesses = await app.inject({
    method: "GET",
    url: "/businesses",
    remoteAddress: "203.0.113.10",
  });
  assert.equal(businesses.statusCode, 401);
  assert.equal(businesses.json().error.code, "AUTHENTICATION_REQUIRED");
});

test("login rate limit uses the forwarded client address behind the loopback proxy", async (t) => {
  const app = await buildApp({
    ...testConfig,
    AUTH_LOGIN_RATE_LIMIT_MAX: 1,
    AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS: 900,
  });
  t.after(async () => app.close());
  stubLogin(app, async () => {
    throw invalidCredentials();
  });

  assert.equal((await app.inject(loginRequest(undefined, "198.51.100.7"))).statusCode, 401);
  assert.equal((await app.inject(loginRequest(undefined, "198.51.100.7"))).statusCode, 429);
  assert.equal((await app.inject(loginRequest(undefined, "198.51.100.8"))).statusCode, 401);
});
