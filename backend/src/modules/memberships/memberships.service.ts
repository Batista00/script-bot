import type { Pool } from "pg";

import { withTransaction } from "../../core/database/database.js";
import { AppError } from "../../core/errors/app-error.js";
import { hashPassword } from "../auth/auth.crypto.js";
import type { UsersRepository } from "../users/users.types.js";
import { UserEmailConflictError } from "../users/users.types.js";
import {
  type BusinessMembership,
  type BusinessMembershipsRepository,
  type BusinessRole,
  MembershipAlreadyExistsError,
  type MembershipStatus,
  type MembershipWithUser,
} from "./memberships.types.js";

export interface CreateMembershipInput {
  email: string;
  role: BusinessRole;
  name?: string | null;
  password?: string | null;
}

export interface UpdateMembershipInput {
  role?: BusinessRole;
  status?: MembershipStatus;
}

function notFound(): AppError {
  return new AppError("Membership not found", 404, "MEMBERSHIP_NOT_FOUND");
}

function roleNotAllowed(message: string): AppError {
  return new AppError(message, 403, "MEMBERSHIP_ROLE_NOT_ALLOWED");
}

export class BusinessMembershipsService {
  constructor(
    private readonly memberships: BusinessMembershipsRepository,
    private readonly users: UsersRepository,
    private readonly db: Pool,
    private readonly passwordHasher: (password: string) => Promise<string> = hashPassword,
  ) {}

  list(businessId: string): Promise<MembershipWithUser[]> {
    return this.memberships.listByBusiness(businessId);
  }

  async create(
    businessId: string,
    input: CreateMembershipInput,
    actor: BusinessMembership,
  ): Promise<MembershipWithUser> {
    this.assertCanAssignRole(actor.role, input.role);
    const email = input.email.trim().toLowerCase();
    const existingUser = await this.users.findByEmail(email);

    if (existingUser === null) {
      return this.createUserAndMembership(businessId, email, input);
    }
    if (existingUser.status !== "active") {
      throw new AppError(
        "User is inactive and cannot receive a membership",
        409,
        "USER_INACTIVE",
      );
    }
    const existingMembership = await this.memberships.findByBusinessAndUserIncludingInactive(
      businessId,
      existingUser.id,
    );
    if (existingMembership) {
      throw new AppError(
        "User already belongs to this business; reactivate the membership instead",
        409,
        "MEMBERSHIP_ALREADY_EXISTS",
      );
    }

    try {
      const membership = await this.memberships.create(businessId, existingUser.id, input.role);
      return await this.requireById(businessId, membership.id);
    } catch (error) {
      if (error instanceof MembershipAlreadyExistsError) {
        throw new AppError(
          "User already belongs to this business; reactivate the membership instead",
          409,
          "MEMBERSHIP_ALREADY_EXISTS",
        );
      }
      throw error;
    }
  }

  async update(
    businessId: string,
    membershipId: string,
    input: UpdateMembershipInput,
    actor: BusinessMembership,
  ): Promise<MembershipWithUser> {
    if (input.role === undefined && input.status === undefined) {
      throw new AppError(
        "At least one membership field must be provided",
        400,
        "EMPTY_MEMBERSHIP_UPDATE",
      );
    }
    const target = await this.requireById(businessId, membershipId);
    this.assertCanManageTarget(actor, target);

    const role = input.role ?? target.role;
    const status = input.status ?? target.status;
    if (role !== target.role) this.assertCanAssignRole(actor.role, role);
    if (status === "active" && target.user.status !== "active") {
      throw new AppError(
        "User is inactive and cannot keep an active membership",
        409,
        "USER_INACTIVE",
      );
    }
    if (target.role === "owner" && target.status === "active" && (role !== "owner" || status !== "active")) {
      await this.assertNotLastActiveOwner(businessId);
    }

    const updated = await this.memberships.update(businessId, membershipId, { role, status });
    if (!updated) throw notFound();
    return updated;
  }

  async remove(
    businessId: string,
    membershipId: string,
    actor: BusinessMembership,
  ): Promise<void> {
    const target = await this.requireById(businessId, membershipId);
    this.assertCanManageTarget(actor, target);
    if (target.role === "owner" && target.status === "active") {
      await this.assertNotLastActiveOwner(businessId);
    }
    if (!await this.memberships.delete(businessId, membershipId)) throw notFound();
  }

  private async createUserAndMembership(
    businessId: string,
    email: string,
    input: CreateMembershipInput,
  ): Promise<MembershipWithUser> {
    const name = input.name?.trim() ?? "";
    if (name.length === 0 || name.length > 120) {
      throw new AppError(
        "name is required to create a new user",
        400,
        "USER_DETAILS_REQUIRED",
      );
    }
    const password = input.password ?? "";
    if (password.length < 12 || password.length > 128) {
      throw new AppError(
        "password must contain between 12 and 128 characters",
        400,
        "INVALID_USER_PASSWORD",
      );
    }
    const passwordHash = await this.passwordHasher(password);

    try {
      const membership = await withTransaction(this.db, async (client) => {
        const user = await this.users.create({ email, name, passwordHash }, client);
        return this.memberships.create(businessId, user.id, input.role, client);
      });
      return await this.requireById(businessId, membership.id);
    } catch (error) {
      if (error instanceof UserEmailConflictError) {
        throw new AppError("Email is already registered", 409, "USER_EMAIL_ALREADY_EXISTS");
      }
      if (error instanceof MembershipAlreadyExistsError) {
        throw new AppError("User already belongs to this business", 409, "MEMBERSHIP_ALREADY_EXISTS");
      }
      throw error;
    }
  }

  private async requireById(businessId: string, membershipId: string): Promise<MembershipWithUser> {
    const membership = await this.memberships.findById(businessId, membershipId);
    if (!membership) throw notFound();
    return membership;
  }

  /**
   * Only an owner can grant or keep the owner role; an admin promoting a member
   * to owner would escalate its own privileges over the business.
   */
  private assertCanAssignRole(actorRole: BusinessRole, role: BusinessRole): void {
    if (role === "owner" && actorRole !== "owner") {
      throw roleNotAllowed("Only an owner can grant the owner role");
    }
  }

  private assertCanManageTarget(actor: BusinessMembership, target: MembershipWithUser): void {
    if (target.role === "owner" && actor.role !== "owner") {
      throw roleNotAllowed("Only an owner can manage owner memberships");
    }
    // An admin never manages its own access, so it cannot lock itself out or
    // self-demote by mistake. Owners keep that ability, bounded by the
    // last-active-owner invariant, so co-owners can rotate responsibilities.
    if (target.userId === actor.userId && actor.role !== "owner") {
      throw new AppError(
        "A membership cannot modify its own access",
        409,
        "MEMBERSHIP_SELF_MODIFICATION",
      );
    }
  }

  private async assertNotLastActiveOwner(businessId: string): Promise<void> {
    if (await this.memberships.countActiveOwners(businessId) > 1) return;
    throw new AppError(
      "The business must keep at least one active owner",
      409,
      "LAST_OWNER_REQUIRED",
    );
  }
}
