import type { DatabaseExecutor } from "../../core/database/database.js";
import type { Business, BusinessStatus } from "../businesses/businesses.types.js";
import type { UserStatus } from "../users/users.types.js";

export const businessRoles = ["owner", "admin", "operator"] as const;

export type BusinessRole = (typeof businessRoles)[number];

export const membershipStatuses = ["active", "inactive"] as const;

export type MembershipStatus = (typeof membershipStatuses)[number];

export interface BusinessMembership {
  id: string;
  businessId: string;
  userId: string;
  role: BusinessRole;
  status: MembershipStatus;
  /**
   * Business status denormalized into the membership read so authorization
   * guards can reject inactive tenants without a second query.
   */
  businessStatus: BusinessStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MembershipWithBusiness extends BusinessMembership {
  business: Business;
}

export interface MembershipUserSummary {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
}

export interface MembershipWithUser extends BusinessMembership {
  user: MembershipUserSummary;
}

export interface MembershipUpdateInput {
  role: BusinessRole;
  status: MembershipStatus;
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

/**
 * Administrative surface over `business_memberships`. Kept separate from
 * `MembershipsRepository` so authentication only depends on the read it needs.
 */
export interface BusinessMembershipsRepository extends MembershipsRepository {
  listByBusiness(businessId: string): Promise<MembershipWithUser[]>;
  findById(businessId: string, membershipId: string): Promise<MembershipWithUser | null>;
  findByBusinessAndUserIncludingInactive(
    businessId: string,
    userId: string,
  ): Promise<MembershipWithUser | null>;
  update(
    businessId: string,
    membershipId: string,
    input: MembershipUpdateInput,
  ): Promise<MembershipWithUser | null>;
  delete(businessId: string, membershipId: string): Promise<boolean>;
  countActiveOwners(businessId: string): Promise<number>;
}

export class MembershipAlreadyExistsError extends Error {}
