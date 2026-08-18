import type { DatabaseExecutor } from "../../core/database/database.js";
import type { BusinessStatus } from "../businesses/businesses.types.js";
import type { BusinessRole } from "../memberships/memberships.types.js";
import type { User } from "../users/users.types.js";

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthenticatedBusiness {
  id: string;
  name: string;
  status: BusinessStatus;
  role: BusinessRole;
}

export interface AuthView {
  user: User;
  businesses: AuthenticatedBusiness[];
}

export interface LoginResult extends AuthView {
  sessionToken: string;
  expiresAt: Date;
}

export interface AuthSessionsRepository {
  create(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
    executor?: DatabaseExecutor,
  ): Promise<void>;
  findActiveUserByTokenHash(tokenHash: string): Promise<User | null>;
  deleteByTokenHash(tokenHash: string): Promise<void>;
}

