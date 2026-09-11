import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import type { Pool } from "pg";

import { buildApp } from "../src/app.js";
import type { Env } from "../src/config/env.js";
import { AppError } from "../src/core/errors/app-error.js";
import { sessionCookieName } from "../src/modules/auth/auth.cookie.js";
import type { BusinessStatus } from "../src/modules/businesses/businesses.types.js";
import {
  type BusinessMembership,
  type BusinessMembershipsRepository,
  type BusinessRole,
  MembershipAlreadyExistsError,
  type MembershipStatus,
  type MembershipUpdateInput,
  type MembershipUserSummary,
  type MembershipWithBusiness,
  type MembershipWithUser,
} from "../src/modules/memberships/memberships.types.js";
import { BusinessMembershipsService } from "../src/modules/memberships/memberships.service.js";
import {
  type CreateUserInput,
  type User,
  UserEmailConflictError,
  type UsersRepository,
  type UserWithPasswordHash,
} from "../src/modules/users/users.types.js";

const now = "2026-08-21T12:00:00.000Z";
const businessA = "0e2f6f5e-72e1-4ec9-8680-0c2185d91c68";
const businessB = "9d1b85eb-ecbf-479c-838f-80e53e98c9a8";
const missingId = "60878fd4-9a90-4f74-8905-d736c8b6ea11";

class MemoryUsersRepository implements UsersRepository {
  readonly users: UserWithPasswordHash[] = [];

  async create(input: CreateUserInput): Promise<User> {
    const email = input.email.trim().toLowerCase();
    if (this.users.some((user) => user.email === email)) throw new UserEmailConflictError();
    const user: UserWithPasswordHash = {
      id: randomUUID(), email, name: input.name, passwordHash: input.passwordHash,
      status: "active", createdAt: now, updatedAt: now,
    };
    this.users.push(user);
    return this.public(user);
  }

  async findByEmail(email: string): Promise<UserWithPasswordHash | null> {
    return this.users.find((user) => user.email === email.trim().toLowerCase()) ?? null;
  }

  async hasAnyUsers(): Promise<boolean> {
    return this.users.length > 0;
  }

  findById(id: string): UserWithPasswordHash | undefined {
    return this.users.find((user) => user.id === id);
  }

  private public(user: UserWithPasswordHash): User {
    const { passwordHash: _passwordHash, ...rest } = user;
    return rest;
  }
}

class MemoryMembershipsRepository implements BusinessMembershipsRepository {
  readonly memberships: MembershipWithUser[] = [];
  readonly businessStatuses = new Map<string, BusinessStatus>();

  constructor(private readonly users: MemoryUsersRepository) {}

  async create(
    businessId: string,
    userId: string,
    role: BusinessRole,
  ): Promise<BusinessMembership> {
    const account = this.users.findById(userId);
    if (!account) throw new Error("unknown user");
    if (this.memberships.some((item) =>
      item.businessId === businessId && item.userId === userId)) {
      throw new MembershipAlreadyExistsError();
    }
    const membership: MembershipWithUser = {
      id: randomUUID(), businessId, userId, role, status: "active",
      businessStatus: this.businessStatuses.get(businessId) ?? "active",
      createdAt: now, updatedAt: now, user: this.summary(account),
    };
    this.memberships.push(membership);
    return membership;
  }

  async findByBusinessAndUser(
    businessId: string,
    userId: string,
  ): Promise<BusinessMembership | null> {
    return this.memberships.find((item) =>
      item.businessId === businessId && item.userId === userId && item.status === "active") ?? null;
  }

  async listForUser(): Promise<MembershipWithBusiness[]> {
    return [];
  }

  async listByBusiness(businessId: string): Promise<MembershipWithUser[]> {
    return this.memberships.filter((item) => item.businessId === businessId);
  }

  async findById(businessId: string, membershipId: string): Promise<MembershipWithUser | null> {
    return this.memberships.find((item) =>
      item.businessId === businessId && item.id === membershipId) ?? null;
  }

  async findByBusinessAndUserIncludingInactive(
    businessId: string,
    userId: string,
  ): Promise<MembershipWithUser | null> {
    return this.memberships.find((item) =>
      item.businessId === businessId && item.userId === userId) ?? null;
  }

  async update(
    businessId: string,
    membershipId: string,
    input: MembershipUpdateInput,
  ): Promise<MembershipWithUser | null> {
    const membership = await this.findById(businessId, membershipId);
    if (!membership) return null;
    membership.role = input.role;
    membership.status = input.status;
    membership.updatedAt = now;
    return membership;
  }

  async delete(businessId: string, membershipId: string): Promise<boolean> {
    const index = this.memberships.findIndex((item) =>
      item.businessId === businessId && item.id === membershipId);
    if (index < 0) return false;
    this.memberships.splice(index, 1);
    return true;
  }

  async countActiveOwners(businessId: string): Promise<number> {
    return this.memberships.filter((item) =>
      item.businessId === businessId && item.role === "owner" && item.status === "active").length;
  }

  private summary(account: UserWithPasswordHash): MembershipUserSummary {
    return {
      id: account.id, email: account.email, name: account.name, status: account.status,
    };
  }
}

function fakePool(): Pool {
  return {
    async connect() {
      return {
        query: async () => ({ rows: [], rowCount: 0 }),
        release: () => undefined,
      };
    },
  } as unknown as Pool;
}

interface Setup {
  users: MemoryUsersRepository;
  memberships: MemoryMembershipsRepository;
  service: BusinessMembershipsService;
  owner: MembershipWithUser;
  admin: MembershipWithUser;
}

async function setup(): Promise<Setup> {
  const users = new MemoryUsersRepository();
  const memberships = new MemoryMembershipsRepository(users);
  const service = new BusinessMembershipsService(
    memberships,
    users,
    fakePool(),
    async (password) => `hashed:${password}`,
  );
  const ownerUser = await users.create({
    email: "owner@example.com", name: "Owner", passwordHash: "hashed:owner-password",
  });
  const adminUser = await users.create({
    email: "admin@example.com", name: "Admin", passwordHash: "hashed:admin-password",
  });
  const owner = await memberships.create(businessA, ownerUser.id, "owner") as MembershipWithUser;
  const admin = await memberships.create(businessA, adminUser.id, "admin") as MembershipWithUser;
  return { users, memberships, service, owner, admin };
}

async function expectAppError(
  promise: Promise<unknown>,
  statusCode: number,
  code: string,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AppError, `expected AppError, got ${String(error)}`);
    assert.equal(error.statusCode, statusCode);
    assert.equal(error.code, code);
    return true;
  });
}

test("owner creates a new user with a membership in one operation", async () => {
  const { service, users, memberships } = await setup();

  const created = await service.create(
    businessA,
    { email: "  New.Operator@Example.com ", role: "operator", name: "  Nueva  ", password: "a-strong-password" },
    memberships.memberships[0]!,
  );

  assert.equal(created.role, "operator");
  assert.equal(created.status, "active");
  assert.equal(created.businessStatus, "active");
  assert.equal(created.user.email, "new.operator@example.com");
  assert.equal(created.user.name, "Nueva");
  assert.equal(users.users.length, 3);
  assert.equal(users.users[2]?.passwordHash, "hashed:a-strong-password");
});

test("owner attaches an existing user without duplicating the account", async () => {
  const { service, users, memberships, owner } = await setup();
  const existing = await users.create({
    email: "existing@example.com", name: "Existente", passwordHash: "hashed",
  });

  const created = await service.create(
    businessA,
    { email: "existing@example.com", role: "operator" },
    owner,
  );

  assert.equal(created.userId, existing.id);
  assert.equal(created.user.name, "Existente");
  assert.equal(users.users.length, 3);
  assert.equal(memberships.memberships.length, 3);
});

test("creating a membership for an existing member is rejected", async () => {
  const { service, admin, owner } = await setup();
  await expectAppError(
    service.create(businessA, { email: "admin@example.com", role: "operator" }, owner),
    409,
    "MEMBERSHIP_ALREADY_EXISTS",
  );
  assert.equal(admin.role, "admin");
});

test("reactivating access requires the membership to exist", async () => {
  const { service, memberships, owner } = await setup();
  const admin = memberships.memberships[1]!;
  await service.update(businessA, admin.id, { status: "inactive" }, owner);
  await expectAppError(
    service.create(businessA, { email: "admin@example.com", role: "operator" }, owner),
    409,
    "MEMBERSHIP_ALREADY_EXISTS",
  );
  const reactivated = await service.update(businessA, admin.id, { status: "active" }, owner);
  assert.equal(reactivated.status, "active");
});

test("a brand new user requires a name and a strong password", async () => {
  const { service, owner } = await setup();
  await expectAppError(
    service.create(businessA, { email: "new@example.com", role: "operator", password: "a-strong-password" }, owner),
    400,
    "USER_DETAILS_REQUIRED",
  );
  await expectAppError(
    service.create(businessA, { email: "new@example.com", role: "operator", name: "Nueva", password: "short" }, owner),
    400,
    "INVALID_USER_PASSWORD",
  );
});

test("an inactive account cannot receive a membership", async () => {
  const { service, users, owner } = await setup();
  const created = await users.create({
    email: "inactive@example.com", name: "Inactivo", passwordHash: "hashed",
  });
  users.users.find((user) => user.id === created.id)!.status = "inactive";

  await expectAppError(
    service.create(businessA, { email: "inactive@example.com", role: "operator" }, owner),
    409,
    "USER_INACTIVE",
  );
});

test("an admin cannot grant the owner role", async () => {
  const { service, admin } = await setup();
  await expectAppError(
    service.create(businessA, { email: "new@example.com", role: "owner", name: "Nueva", password: "a-strong-password" }, admin),
    403,
    "MEMBERSHIP_ROLE_NOT_ALLOWED",
  );
});

test("an admin cannot manage an owner membership", async () => {
  const { service, memberships, owner, admin } = await setup();
  const operator = await service.create(
    businessA, { email: "op@example.com", role: "operator", name: "Op", password: "a-strong-password" }, owner,
  );
  await expectAppError(
    service.update(businessA, owner.id, { status: "inactive" }, admin),
    403,
    "MEMBERSHIP_ROLE_NOT_ALLOWED",
  );
  await expectAppError(service.remove(businessA, owner.id, admin), 403, "MEMBERSHIP_ROLE_NOT_ALLOWED");
  assert.equal(memberships.memberships.length, 3);
  assert.equal(operator.role, "operator");
});

test("an admin cannot modify its own membership", async () => {
  const { service, admin } = await setup();
  await expectAppError(
    service.update(businessA, admin.id, { role: "operator" }, admin),
    409,
    "MEMBERSHIP_SELF_MODIFICATION",
  );
  await expectAppError(
    service.update(businessA, admin.id, { status: "inactive" }, admin),
    409,
    "MEMBERSHIP_SELF_MODIFICATION",
  );
  await expectAppError(service.remove(businessA, admin.id, admin), 409, "MEMBERSHIP_SELF_MODIFICATION");
});

test("the last active owner cannot be demoted, deactivated or removed", async () => {
  const { service, memberships, owner } = await setup();
  await expectAppError(
    service.update(businessA, owner.id, { role: "admin" }, owner),
    409,
    "LAST_OWNER_REQUIRED",
  );
  await expectAppError(
    service.update(businessA, owner.id, { status: "inactive" }, owner),
    409,
    "LAST_OWNER_REQUIRED",
  );
  await expectAppError(service.remove(businessA, owner.id, owner), 409, "LAST_OWNER_REQUIRED");
  assert.equal(await memberships.countActiveOwners(businessA), 1);
});

test("a sole owner cannot step down even after adding an admin", async () => {
  const { service, memberships, owner } = await setup();
  const created = await service.create(
    businessA, { email: "second@example.com", role: "admin", name: "Segundo", password: "a-strong-password" }, owner,
  );
  await expectAppError(
    service.update(businessA, owner.id, { role: "admin" }, owner),
    409,
    "LAST_OWNER_REQUIRED",
  );
  assert.equal(created.role, "admin");
  assert.equal(await memberships.countActiveOwners(businessA), 1);
});

test("an owner can step down once another active owner exists", async () => {
  const { service, memberships, owner } = await setup();
  const secondOwner = await service.create(
    businessA, { email: "second@example.com", role: "owner", name: "Segundo", password: "a-strong-password" }, owner,
  );
  const demoted = await service.update(businessA, owner.id, { role: "admin" }, secondOwner);
  assert.equal(demoted.role, "admin");
  assert.equal(await memberships.countActiveOwners(businessA), 1);
});

test("membership management is isolated per business", async () => {
  const { service, owner } = await setup();
  await expectAppError(
    service.update(businessB, owner.id, { role: "admin" }, owner),
    404,
    "MEMBERSHIP_NOT_FOUND",
  );
  await expectAppError(service.remove(businessB, owner.id, owner), 404, "MEMBERSHIP_NOT_FOUND");
});

test("updating without fields and removing a missing membership fail explicitly", async () => {
  const { service, owner } = await setup();
  await expectAppError(service.update(businessA, owner.id, {}, owner), 400, "EMPTY_MEMBERSHIP_UPDATE");
  await expectAppError(service.remove(businessA, missingId, owner), 404, "MEMBERSHIP_NOT_FOUND");
});

test("an owner can change a role and remove a membership", async () => {
  const { service, memberships, owner } = await setup();
  const operator = await service.create(
    businessA, { email: "op@example.com", role: "operator", name: "Op", password: "a-strong-password" }, owner,
  );
  const promoted = await service.update(businessA, operator.id, { role: "admin" }, owner);
  assert.equal(promoted.role, "admin");
  await service.remove(businessA, operator.id, owner);
  assert.equal(memberships.memberships.length, 2);
});

const config: Env = {
  NODE_ENV: "test", PORT: 3_000,
  DATABASE_URL: "postgresql://bot:test@localhost:5432/bot_whatsapp",
  LOG_LEVEL: "silent", AUTH_SESSION_TTL_HOURS: 168,
};

async function appWithMembership(
  businessStatus: BusinessStatus,
  role: BusinessRole | null,
) {
  const app = await buildApp(config);
  app.authService.authenticate = async (session) => {
    if (session !== "session") {
      throw new AppError("Authentication required", 401, "AUTHENTICATION_REQUIRED");
    }
    return {
      id: "5c4c1cf0-bcc5-44de-bb63-2e8aeb8cb576", email: "actor@example.com",
      name: "Actor", status: "active" as const, createdAt: now, updatedAt: now,
    };
  };
  app.membershipsRepository.findByBusinessAndUser = async () =>
    role === null ? null : {
      id: "3939b80f-2613-4a4d-8ac7-f3fe5924e406", businessId: businessA,
      userId: "5c4c1cf0-bcc5-44de-bb63-2e8aeb8cb576", role, status: "active" as const,
      businessStatus, createdAt: now, updatedAt: now,
    };
  return app;
}

test("operator cannot manage memberships", async (t) => {
  const app = await appWithMembership("active", "operator");
  t.after(async () => app.close());
  const response = await app.inject({
    method: "GET", url: `/businesses/${businessA}/memberships`,
    headers: { cookie: `${sessionCookieName}=session` },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, "INSUFFICIENT_BUSINESS_ROLE");
});

test("membership routes require authentication and membership of the business", async (t) => {
  const anonymous = await appWithMembership("active", "owner");
  t.after(async () => anonymous.close());
  const unauthorized = await anonymous.inject({
    method: "GET", url: `/businesses/${businessA}/memberships`,
  });
  assert.equal(unauthorized.statusCode, 401);

  const outsider = await appWithMembership("active", null);
  t.after(async () => outsider.close());
  const notFound = await outsider.inject({
    method: "GET", url: `/businesses/${businessA}/memberships`,
    headers: { cookie: `${sessionCookieName}=session` },
  });
  assert.equal(notFound.statusCode, 404);
  assert.equal(notFound.json().error.code, "BUSINESS_NOT_FOUND");
});

test("membership administration stays available for an inactive business", async (t) => {
  const app = await appWithMembership("inactive", "owner");
  t.after(async () => app.close());
  app.db.query = (async () => ({ rows: [], rowCount: 0 })) as unknown as typeof app.db.query;

  const response = await app.inject({
    method: "GET", url: `/businesses/${businessA}/memberships`,
    headers: { cookie: `${sessionCookieName}=session` },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), []);
});

test("an invalid membership payload is rejected before touching the service", async (t) => {
  const app = await appWithMembership("active", "owner");
  t.after(async () => app.close());
  const response = await app.inject({
    method: "POST",
    url: `/businesses/${businessA}/memberships`,
    headers: { cookie: `${sessionCookieName}=session` },
    payload: { email: "not-an-email" },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "INVALID_REQUEST");
});
