import { z } from "zod";

import { loadEnv } from "../config/env.js";
import { createDatabasePool, withTransaction } from "../core/database/database.js";
import { hashPassword } from "../modules/auth/auth.crypto.js";
import { PostgresBusinessesRepository } from "../modules/businesses/businesses.repository.js";
import { PostgresMembershipsRepository } from "../modules/memberships/memberships.repository.js";
import { PostgresUsersRepository } from "../modules/users/users.repository.js";

const bootstrapSchema = z.object({
  BOOTSTRAP_BUSINESS_ID: z.string().uuid(),
  BOOTSTRAP_OWNER_NAME: z.string().trim().min(1).max(120),
  BOOTSTRAP_OWNER_EMAIL: z.string().trim().toLowerCase().email().max(254),
  BOOTSTRAP_OWNER_PASSWORD: z.string().min(12).max(128),
});

async function bootstrapOwner(): Promise<void> {
  const config = loadEnv();
  const input = bootstrapSchema.parse(process.env);
  const passwordHash = await hashPassword(input.BOOTSTRAP_OWNER_PASSWORD);
  const db = createDatabasePool(config.DATABASE_URL);
  const businesses = new PostgresBusinessesRepository(db);
  const users = new PostgresUsersRepository(db);
  const memberships = new PostgresMembershipsRepository(db);

  try {
    const user = await withTransaction(db, async (client) => {
      const business = await businesses.findById(input.BOOTSTRAP_BUSINESS_ID, client);
      if (!business) throw new Error("Bootstrap business does not exist");

      const existingUser = await users.findByEmail(input.BOOTSTRAP_OWNER_EMAIL, client);
      if (existingUser) throw new Error("Bootstrap owner email already exists");

      const createdUser = await users.create(
        {
          email: input.BOOTSTRAP_OWNER_EMAIL,
          name: input.BOOTSTRAP_OWNER_NAME,
          passwordHash,
        },
        client,
      );
      await memberships.create(business.id, createdUser.id, "owner", client);
      return createdUser;
    });

    console.info(
      `Owner created: user=${user.id} email=${user.email} business=${input.BOOTSTRAP_BUSINESS_ID}`,
    );
  } finally {
    await db.end();
  }
}

bootstrapOwner().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown bootstrap error";
  console.error(`Owner bootstrap failed: ${message}`);
  process.exitCode = 1;
});
