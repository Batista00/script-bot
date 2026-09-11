import type { FastifyPluginAsync } from "fastify";

import {
  requireAuthenticatedUser,
  requireBusinessMembership,
  requireBusinessRole,
} from "../auth/auth.middleware.js";
import { requireActiveBusiness } from "../businesses/businesses.active.middleware.js";
import {
  type FulfillmentIdParams,
  type FulfillmentBusinessParams,
  type FulfillmentOrderParams,
  FulfillmentsController,
} from "./fulfillments.controller.js";
import {
  dispatchFulfillmentSchema,
  getFulfillmentSchema,
  listFulfillmentsSchema,
  listBusinessFulfillmentsSchema,
  retryFulfillmentSchema,
  syncFulfillmentStatusSchema,
} from "./fulfillments.schema.js";
import { FulfillmentsService } from "./fulfillments.service.js";
import type {
  DispatchFulfillmentInput,
  FulfillmentListQuery,
} from "./fulfillments.types.js";

interface FulfillmentsRoutesOptions { service: FulfillmentsService }

export const fulfillmentsRoutes: FastifyPluginAsync<FulfillmentsRoutesOptions> = async (
  app,
  options,
) => {
  const controller = new FulfillmentsController(options.service);
  const membership = [
    requireAuthenticatedUser(app.authService),
    requireBusinessMembership(app.membershipsRepository),
  ];
  const operations = [...membership, requireBusinessRole(["owner", "admin", "operator"])];
  const administration = [...membership, requireBusinessRole(["owner", "admin"])];
  const activeBusiness = requireActiveBusiness();
  const commercialOperations = [...operations, activeBusiness];
  const commercialAdministration = [...administration, activeBusiness];

  app.post<{ Params: FulfillmentOrderParams; Body: DispatchFulfillmentInput }>(
    "/businesses/:businessId/orders/:orderId/fulfillments",
    { schema: dispatchFulfillmentSchema, preHandler: commercialOperations },
    controller.dispatch,
  );
  app.get<{ Params: FulfillmentOrderParams }>(
    "/businesses/:businessId/orders/:orderId/fulfillments",
    { schema: listFulfillmentsSchema, preHandler: operations },
    controller.listByOrder,
  );
  app.get<{ Params: FulfillmentBusinessParams; Querystring: FulfillmentListQuery }>(
    "/businesses/:businessId/fulfillments",
    { schema: listBusinessFulfillmentsSchema, preHandler: operations },
    controller.list,
  );
  app.get<{ Params: FulfillmentIdParams }>(
    "/businesses/:businessId/fulfillments/:fulfillmentId",
    { schema: getFulfillmentSchema, preHandler: operations },
    controller.getById,
  );
  app.post<{ Params: FulfillmentIdParams }>(
    "/businesses/:businessId/fulfillments/:fulfillmentId/retry",
    { schema: retryFulfillmentSchema, preHandler: commercialAdministration },
    controller.retry,
  );
  app.post<{ Params: FulfillmentIdParams }>(
    "/businesses/:businessId/fulfillments/:fulfillmentId/sync-status",
    { schema: syncFulfillmentStatusSchema, preHandler: operations },
    controller.syncStatus,
  );
};
