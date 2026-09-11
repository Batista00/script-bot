import type { FastifyInstance } from "fastify";
import { requireAuthenticatedUser,requireBusinessMembership,requireBusinessRole } from "../auth/auth.middleware.js";
import { DigitalDeliveryController } from "./digital-delivery.controller.js";
import type { DigitalDeliveryService } from "./digital-delivery.service.js";
export function digitalDeliveryRoutes(app:FastifyInstance,service:DigitalDeliveryService){
  const controller=new DigitalDeliveryController(service);
  const preHandler=[requireAuthenticatedUser(app.authService),requireBusinessMembership(app.membershipsRepository),requireBusinessRole(["owner","admin"])];
  app.get("/businesses/:businessId/products/:productId/digital-assets",{preHandler},controller.list);
  app.post("/businesses/:businessId/products/:productId/digital-assets",{preHandler},controller.add);
  app.patch("/businesses/:businessId/products/:productId/digital-assets/:assetId",{preHandler},controller.status);
}
