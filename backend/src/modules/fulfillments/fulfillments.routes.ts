import type { FastifyPluginAsync } from "fastify";

import {
  requireAuthenticatedUser,
  requireBusinessMembership,
  requireBusinessRole,
} from "../auth/auth.middleware.js";
import {
  type FulfillmentIdParams,
  type FulfillmentOrderParams,
  FulfillmentsController,
} from "./fulfillments.controller.js";
import {
  dispatchFulfillmentSchema,
  getFulfillmentSchema,
  listFulfillmentsSchema,
  retryFulfillmentSchema,
  syncFulfillmentStatusSchema,
} from "./fulfillments.schema.js";
import { FulfillmentsService } from "./fulfillments.service.js";
import type { DispatchFulfillmentInput } from "./fulfillments.types.js";

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

  app.post<{ Params: FulfillmentOrderParams; Body: DispatchFulfillmentInput }>(
    "/businesses/:businessId/orders/:orderId/fulfillments",
    { schema: dispatchFulfillmentSchema, preHandler: operations },
    controller.dispatch,
  );
  app.get<{ Params: FulfillmentOrderParams }>(
    "/businesses/:businessId/orders/:orderId/fulfillments",
    { schema: listFulfillmentsSchema, preHandler: operations },
    controller.listByOrder,
  );
  app.get<{ Params: FulfillmentIdParams }>(
    "/businesses/:businessId/fulfillments/:fulfillmentId",
    { schema: getFulfillmentSchema, preHandler: operations },
    controller.getById,
  );
  app.post<{ Params: FulfillmentIdParams }>(
    "/businesses/:businessId/fulfillments/:fulfillmentId/retry",
    { schema: retryFulfillmentSchema, preHandler: administration },
    controller.retry,
  );
  app.post<{ Params: FulfillmentIdParams }>(
    "/businesses/:businessId/fulfillments/:fulfillmentId/sync-status",
    { schema: syncFulfillmentStatusSchema, preHandler: operations },
    controller.syncStatus,
  );
};
