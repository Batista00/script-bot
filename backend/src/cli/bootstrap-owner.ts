import type { Pool } from "pg";

import { withTransaction } from "../core/database/database.js";
import { hashPassword } from "../modules/auth/auth.crypto.js";
import type {
  Business,
  BusinessesRepository,
} from "../modules/businesses/businesses.types.js";
import type {
  BusinessMembership,
  MembershipsRepository,
} from "../modules/memberships/memberships.types.js";
import type { User, UsersRepository } from "../modules/users/users.types.js";

export interface BootstrapOwnerInput {
  businessName: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
}

export interface BootstrapOwnerRepositories {
  businesses: BusinessesRepository;
  users: UsersRepository;
  memberships: MembershipsRepository;
}

export interface BootstrapOwnerResult {
  business: Business;
  user: User;
  membership: BusinessMembership;
}

export async function createInitialOwner(
  db: Pool,
  repositories: BootstrapOwnerRepositories,
  input: BootstrapOwnerInput,
): Promise<BootstrapOwnerResult> {
  const passwordHash = await hashPassword(input.ownerPassword);

  return withTransaction(db, async (client) => {
    if (await repositories.users.hasAnyUsers(client)) {
      throw new Error("Bootstrap refused: system already initialized");
    }

    const business = await repositories.businesses.create(input.businessName, client);
    const user = await repositories.users.create(
      {
        email: input.ownerEmail,
        name: input.ownerName,
        passwordHash,
      },
      client,
    );
    const membership = await repositories.memberships.create(
      business.id,
      user.id,
      "owner",
      client,
    );

    return { business, user, membership };
  });
}
