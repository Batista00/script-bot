import type { FastifyPluginAsync } from "fastify";

import {
  requireAuthenticatedUser,
  requireBusinessMembership,
  requireBusinessRole,
} from "../auth/auth.middleware.js";
import {
  BusinessMembershipsController,
  type MembershipBusinessParams,
  type MembershipItemParams,
} from "./memberships.controller.js";
import {
  createMembershipSchema,
  deleteMembershipSchema,
  listMembershipsSchema,
  updateMembershipSchema,
} from "./memberships.schema.js";
import { BusinessMembershipsService } from "./memberships.service.js";
import type {
  CreateMembershipInput,
  UpdateMembershipInput,
} from "./memberships.service.js";

interface BusinessMembershipsRoutesOptions { service: BusinessMembershipsService }

export const businessMembershipsRoutes: FastifyPluginAsync<
  BusinessMembershipsRoutesOptions
> = async (app, options) => {
  const controller = new BusinessMembershipsController(options.service);
  const authorization = [
    requireAuthenticatedUser(app.authService),
    requireBusinessMembership(app.membershipsRepository),
    requireBusinessRole(["owner", "admin"]),
  ];

  app.get<{ Params: MembershipBusinessParams }>(
    "/businesses/:businessId/memberships",
    { schema: listMembershipsSchema, preHandler: authorization },
    controller.list,
  );
  app.post<{ Params: MembershipBusinessParams; Body: CreateMembershipInput }>(
    "/businesses/:businessId/memberships",
    { schema: createMembershipSchema, preHandler: authorization },
    controller.create,
  );
  app.patch<{ Params: MembershipItemParams; Body: UpdateMembershipInput }>(
    "/businesses/:businessId/memberships/:membershipId",
    { schema: updateMembershipSchema, preHandler: authorization },
    controller.update,
  );
  app.delete<{ Params: MembershipItemParams }>(
    "/businesses/:businessId/memberships/:membershipId",
    { schema: deleteMembershipSchema, preHandler: authorization },
    controller.remove,
  );
};
