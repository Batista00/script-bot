import assert from "node:assert/strict";
import { test } from "node:test";
import type { FastifyRequest, preHandlerHookHandler } from "fastify";

import { buildApp } from "../src/app.js";
import type { Env } from "../src/config/env.js";
import { AppError } from "../src/core/errors/app-error.js";
import { hashPassword } from "../src/modules/auth/auth.crypto.js";
import { requireBusinessRole } from "../src/modules/auth/auth.middleware.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import type { AuthSessionsRepository } from "../src/modules/auth/auth.types.js";
import type {
  BusinessMembership,
  MembershipsRepository,
} from "../src/modules/memberships/memberships.types.js";
import type { User, UsersRepository, UserWithPasswordHash } from "../src/modules/users/users.types.js";

const testConfig: Env = {
  NODE_ENV: "test",
  PORT: 3_000,
  DATABASE_URL: "postgresql://bot:test@localhost:5432/bot_whatsapp",
  LOG_LEVEL: "silent",
  AUTH_SESSION_TTL_HOURS: 168,
};

const userBase: User = {
  id: "46f5476a-c7e9-403f-9fff-fc3bb234c8b6",
  email: "owner@example.com",
  name: "Owner",
  status: "active",
  createdAt: "2026-08-18T12:00:00.000Z",
  updatedAt: "2026-08-18T12:00:00.000Z",
};

function usersStub(user: UserWithPasswordHash | null): UsersRepository {
  return {
    create: async () => userBase,
    findByEmail: async () => user,
  };
}

function membershipsStub(): MembershipsRepository {
  return {
    create: async () => {
      throw new Error("Not used");
    },
    findByBusinessAndUser: async () => null,
    listForUser: async () => [],
  };
}

function sessionsStub(overrides: Partial<AuthSessionsRepository> = {}): AuthSessionsRepository {
  return {
    create: async () => undefined,
    findActiveUserByTokenHash: async () => null,
    deleteByTokenHash: async () => undefined,
    ...overrides,
  };
}

function assertInvalidCredentials(error: unknown): boolean {
  return (
    error instanceof AppError &&
    error.statusCode === 401 &&
    error.code === "INVALID_CREDENTIALS" &&
    error.message === "Invalid email or password"
  );
}

test("login accepts a valid password and stores only a token hash", async () => {
  const passwordHash = await hashPassword("correct-password");
  let persistedHash = "";
  const service = new AuthService(
    usersStub({ ...userBase, passwordHash }),
    sessionsStub({
      create: async (_userId, tokenHash) => {
        persistedHash = tokenHash;
      },
    }),
    membershipsStub(),
    24,
  );

  const result = await service.login({
    email: " OWNER@example.com ",
    password: "correct-password",
  });

  assert.equal(result.user.id, userBase.id);
  assert.match(result.sessionToken, /^[A-Za-z0-9_-]+$/);
  assert.match(persistedHash, /^[a-f0-9]{64}$/);
  assert.notEqual(persistedHash, result.sessionToken);
  assert.equal("passwordHash" in result.user, false);
});

test("login rejects a wrong password with the uniform credentials error", async () => {
  const passwordHash = await hashPassword("correct-password");
  const service = new AuthService(
    usersStub({ ...userBase, passwordHash }),
    sessionsStub(),
    membershipsStub(),
    24,
  );

  await assert.rejects(
    service.login({ email: userBase.email, password: "wrong-password" }),
    assertInvalidCredentials,
  );
});

test("login rejects a nonexistent user with the same credentials error", async () => {
  const service = new AuthService(usersStub(null), sessionsStub(), membershipsStub(), 24);

  await assert.rejects(
    service.login({ email: "missing@example.com", password: "any-password" }),
    assertInvalidCredentials,
  );
});

test("login rejects an inactive user", async () => {
  const passwordHash = await hashPassword("correct-password");
  const service = new AuthService(
    usersStub({ ...userBase, status: "inactive", passwordHash }),
    sessionsStub(),
    membershipsStub(),
    24,
  );

  await assert.rejects(
    service.login({ email: userBase.email, password: "correct-password" }),
    assertInvalidCredentials,
  );
});

test("GET /auth/me and GET /businesses reject a missing session", async (t) => {
  const app = await buildApp(testConfig);
  t.after(async () => app.close());

  const meResponse = await app.inject({ method: "GET", url: "/auth/me" });
  const businessesResponse = await app.inject({ method: "GET", url: "/businesses" });

  assert.equal(meResponse.statusCode, 401);
  assert.equal(meResponse.json().error.code, "AUTHENTICATION_REQUIRED");
  assert.equal(businessesResponse.statusCode, 401);
  assert.equal(businessesResponse.json().error.code, "AUTHENTICATION_REQUIRED");
});

const membershipBase: BusinessMembership = {
  id: "273676c0-da1f-47d4-a0a7-15624760233b",
  businessId: "0e2f6f5e-72e1-4ec9-8680-0c2185d91c68",
  userId: userBase.id,
  role: "owner",
  createdAt: userBase.createdAt,
  updatedAt: userBase.updatedAt,
};

async function runRoleGuard(membership: BusinessMembership): Promise<void> {
  const guard = requireBusinessRole(["owner", "admin"]) as (
    request: FastifyRequest,
  ) => Promise<void>;
  await guard({ businessMembership: membership } as FastifyRequest);
}

test("operator cannot update a business", async () => {
  await assert.rejects(
    runRoleGuard({ ...membershipBase, role: "operator" }),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 403 &&
      error.code === "INSUFFICIENT_BUSINESS_ROLE",
  );
});

test("owner and admin can pass the business update role guard", async () => {
  await runRoleGuard({ ...membershipBase, role: "owner" });
  await runRoleGuard({ ...membershipBase, role: "admin" });
});

test("logout deletes the session and makes its token invalid", async () => {
  const activeHashes = new Set<string>();
  const passwordHash = await hashPassword("correct-password");
  const sessions = sessionsStub({
    create: async (_userId, tokenHash) => {
      activeHashes.add(tokenHash);
    },
    findActiveUserByTokenHash: async (tokenHash) =>
      activeHashes.has(tokenHash) ? userBase : null,
    deleteByTokenHash: async (tokenHash) => {
      activeHashes.delete(tokenHash);
    },
  });
  const service = new AuthService(
    usersStub({ ...userBase, passwordHash }),
    sessions,
    membershipsStub(),
    24,
  );
  const login = await service.login({
    email: userBase.email,
    password: "correct-password",
  });

  assert.equal((await service.authenticate(login.sessionToken)).id, userBase.id);
  await service.logout(login.sessionToken);
  await assert.rejects(
    service.authenticate(login.sessionToken),
    (error: unknown) => error instanceof AppError && error.code === "INVALID_SESSION",
  );
});
