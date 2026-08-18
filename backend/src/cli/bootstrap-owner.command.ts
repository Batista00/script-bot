import { z } from "zod";

import { loadEnv } from "../config/env.js";
import { createDatabasePool } from "../core/database/database.js";
import { PostgresBusinessesRepository } from "../modules/businesses/businesses.repository.js";
import { PostgresMembershipsRepository } from "../modules/memberships/memberships.repository.js";
import { PostgresUsersRepository } from "../modules/users/users.repository.js";
import { createInitialOwner } from "./bootstrap-owner.js";

const bootstrapSchema = z.object({
  BOOTSTRAP_BUSINESS_NAME: z.string().trim().min(1).max(120),
  BOOTSTRAP_OWNER_NAME: z.string().trim().min(1).max(120),
  BOOTSTRAP_OWNER_EMAIL: z.string().trim().toLowerCase().email().max(254),
  BOOTSTRAP_OWNER_PASSWORD: z.string().min(12).max(128),
});

async function runBootstrapOwner(): Promise<void> {
  const config = loadEnv();
  const input = bootstrapSchema.parse(process.env);
  const db = createDatabasePool(config.DATABASE_URL);

  try {
    const result = await createInitialOwner(
      db,
      {
        businesses: new PostgresBusinessesRepository(db),
        users: new PostgresUsersRepository(db),
        memberships: new PostgresMembershipsRepository(db),
      },
      {
        businessName: input.BOOTSTRAP_BUSINESS_NAME,
        ownerName: input.BOOTSTRAP_OWNER_NAME,
        ownerEmail: input.BOOTSTRAP_OWNER_EMAIL,
        ownerPassword: input.BOOTSTRAP_OWNER_PASSWORD,
      },
    );

    console.info(
      `Bootstrap completed: business=${result.business.id} user=${result.user.id} email=${result.user.email}`,
    );
  } finally {
    await db.end();
  }
}

runBootstrapOwner().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown bootstrap error";
  console.error(`Owner bootstrap failed: ${message}`);
  process.exitCode = 1;
});
