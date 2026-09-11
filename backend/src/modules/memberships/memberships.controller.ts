import type { FastifyReply, FastifyRequest } from "fastify";

import { requireMembershipContext } from "../auth/auth.middleware.js";
import type {
  CreateMembershipInput,
  UpdateMembershipInput,
} from "./memberships.service.js";
import { BusinessMembershipsService } from "./memberships.service.js";
import type {
  BusinessRole,
  MembershipStatus,
  MembershipWithUser,
} from "./memberships.types.js";

export interface MembershipBusinessParams { businessId: string }
export interface MembershipItemParams { businessId: string; membershipId: string }

export interface MembershipDto {
  id: string;
  businessId: string;
  userId: string;
  role: BusinessRole;
  status: MembershipStatus;
  createdAt: string;
  updatedAt: string;
  user: { id: string; email: string; name: string; status: string };
}

export function toMembershipDto(membership: MembershipWithUser): MembershipDto {
  return {
    id: membership.id,
    businessId: membership.businessId,
    userId: membership.userId,
    role: membership.role,
    status: membership.status,
    createdAt: membership.createdAt,
    updatedAt: membership.updatedAt,
    user: {
      id: membership.user.id,
      email: membership.user.email,
      name: membership.user.name,
      status: membership.user.status,
    },
  };
}

export class BusinessMembershipsController {
  constructor(private readonly service: BusinessMembershipsService) {}

  list = async (
    request: FastifyRequest<{ Params: MembershipBusinessParams }>,
    reply: FastifyReply,
  ) => {
    const memberships = await this.service.list(request.params.businessId);
    return reply.status(200).send(memberships.map(toMembershipDto));
  };

  create = async (
    request: FastifyRequest<{
      Params: MembershipBusinessParams; Body: CreateMembershipInput;
    }>,
    reply: FastifyReply,
  ) => reply.status(201).send(toMembershipDto(await this.service.create(
    request.params.businessId,
    request.body,
    requireMembershipContext(request.businessMembership),
  )));

  update = async (
    request: FastifyRequest<{
      Params: MembershipItemParams; Body: UpdateMembershipInput;
    }>,
    reply: FastifyReply,
  ) => reply.status(200).send(toMembershipDto(await this.service.update(
    request.params.businessId,
    request.params.membershipId,
    request.body,
    requireMembershipContext(request.businessMembership),
  )));

  remove = async (
    request: FastifyRequest<{ Params: MembershipItemParams }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    await this.service.remove(
      request.params.businessId,
      request.params.membershipId,
      requireMembershipContext(request.businessMembership),
    );
    return reply.status(204).send();
  };
}
