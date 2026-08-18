import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";

import {
  createInitialOwner,
  type BootstrapOwnerInput,
  type BootstrapOwnerRepositories,
} from "../src/cli/bootstrap-owner.js";
import type { Business } from "../src/modules/businesses/businesses.types.js";
import type { BusinessMembership } from "../src/modules/memberships/memberships.types.js";
import type { User } from "../src/modules/users/users.types.js";

type FailureStage = "business" | "user" | "membership";

interface StoredState {
  businesses: Business[];
  users: User[];
  memberships: BusinessMembership[];
}

const input: BootstrapOwnerInput = {
  businessName: "Full Digital",
  ownerName: "Initial Owner",
  ownerEmail: "owner@example.com",
  ownerPassword: "correct-password",
};

const now = "2026-08-18T12:00:00.000Z";

function cloneState(state: StoredState): StoredState {
  return {
    businesses: [...state.businesses],
    users: [...state.users],
    memberships: [...state.memberships],
  };
}

class TransactionHarness {
  committed: StoredState = { businesses: [], users: [], memberships: [] };
  private pending: StoredState | null = null;

  readonly pool = {
    connect: async () => ({
      query: async (statement: string) => {
        if (statement === "BEGIN") this.pending = cloneState(this.committed);
        if (statement === "COMMIT" && this.pending) this.committed = this.pending;
        if (statement === "COMMIT" || statement === "ROLLBACK") this.pending = null;
        return { rows: [] };
      },
      release: () => undefined,
    }),
  } as unknown as Pool;

  get transactionState(): StoredState {
    if (!this.pending) throw new Error("Repository called outside a transaction");
    return this.pending;
  }
}

function createHarness(failureStage?: FailureStage): {
  database: TransactionHarness;
  repositories: BootstrapOwnerRepositories;
} {
  const database = new TransactionHarness();
  const business: Business = {
    id: "0e2f6f5e-72e1-4ec9-8680-0c2185d91c68",
    name: input.businessName,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  const user: User = {
    id: "46f5476a-c7e9-403f-9fff-fc3bb234c8b6",
    email: input.ownerEmail,
    name: input.ownerName,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  const membership: BusinessMembership = {
    id: "273676c0-da1f-47d4-a0a7-15624760233b",
    businessId: business.id,
    userId: user.id,
    role: "owner",
    createdAt: now,
    updatedAt: now,
  };

  return {
    database,
    repositories: {
      businesses: {
        create: async () => {
          if (failureStage === "business") throw new Error("business failed");
          database.transactionState.businesses.push(business);
          return business;
        },
        listForUser: async () => [],
        findById: async () => null,
        update: async () => null,
      },
      users: {
        create: async () => {
          if (failureStage === "user") throw new Error("user failed");
          database.transactionState.users.push(user);
          return user;
        },
        findByEmail: async () => null,
        hasAnyUsers: async () => database.transactionState.users.length > 0,
      },
      memberships: {
        create: async () => {
          if (failureStage === "membership") throw new Error("membership failed");
          database.transactionState.memberships.push(membership);
          return membership;
        },
        findByBusinessAndUser: async () => null,
        listForUser: async () => [],
      },
    },
  };
}

test("bootstrap creates a business, user, and owner membership", async () => {
  const { database, repositories } = createHarness();

  const result = await createInitialOwner(database.pool, repositories, input);

  assert.equal(database.committed.businesses.length, 1);
  assert.equal(database.committed.users.length, 1);
  assert.equal(database.committed.memberships.length, 1);
  assert.equal(result.membership.role, "owner");
  assert.equal(result.membership.businessId, result.business.id);
  assert.equal(result.membership.userId, result.user.id);
});

test("bootstrap does not create a user when business creation fails", async () => {
  const { database, repositories } = createHarness("business");

  await assert.rejects(createInitialOwner(database.pool, repositories, input));

  assert.deepEqual(database.committed, { businesses: [], users: [], memberships: [] });
});

test("bootstrap rolls back the business when user creation fails", async () => {
  const { database, repositories } = createHarness("user");

  await assert.rejects(createInitialOwner(database.pool, repositories, input));

  assert.deepEqual(database.committed, { businesses: [], users: [], memberships: [] });
});

test("bootstrap rolls back the business and user when membership creation fails", async () => {
  const { database, repositories } = createHarness("membership");

  await assert.rejects(createInitialOwner(database.pool, repositories, input));

  assert.deepEqual(database.committed, { businesses: [], users: [], memberships: [] });
});

test("bootstrap is refused when any user already exists", async () => {
  const { database, repositories } = createHarness();
  database.committed.users.push({
    id: "8d15166c-4fc9-43cb-85a3-f1794da8ccf7",
    email: "existing@example.com",
    name: "Existing User",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  await assert.rejects(
    createInitialOwner(database.pool, repositories, input),
    new Error("Bootstrap refused: system already initialized"),
  );
  assert.equal(database.committed.businesses.length, 0);
  assert.equal(database.committed.users.length, 1);
  assert.equal(database.committed.memberships.length, 0);
});
