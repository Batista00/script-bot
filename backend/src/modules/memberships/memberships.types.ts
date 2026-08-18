import type { DatabaseExecutor } from "../../core/database/database.js";
import type { Business } from "../businesses/businesses.types.js";

export const businessRoles = ["owner", "admin", "operator"] as const;

export type BusinessRole = (typeof businessRoles)[number];

export interface BusinessMembership {
  id: string;
  businessId: string;
  userId: string;
  role: BusinessRole;
  createdAt: string;
  updatedAt: string;
}

export interface MembershipWithBusiness extends BusinessMembership {
  business: Business;
}

export interface MembershipsRepository {
  create(
    businessId: string,
    userId: string,
    role: BusinessRole,
    executor?: DatabaseExecutor,
  ): Promise<BusinessMembership>;
  findByBusinessAndUser(
    businessId: string,
    userId: string,
    executor?: DatabaseExecutor,
  ): Promise<BusinessMembership | null>;
  listForUser(userId: string, executor?: DatabaseExecutor): Promise<MembershipWithBusiness[]>;
}

