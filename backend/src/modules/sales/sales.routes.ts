import type { FastifyPluginAsync } from "fastify";
import { requireAuthenticatedUser,requireBusinessMembership,requireBusinessRole } from "../auth/auth.middleware.js";
import { requireMachineCredential } from "../machine-auth/machine-auth.middleware.js";
import type { MachineAuthService } from "../machine-auth/machine-auth.service.js";
import type { SalesController } from "./sales.controller.js";
import type { SalesAdminController } from "./sales-admin.controller.js";
import type { AutomationController } from "../automation/automation.controller.js";

interface Options { controller:SalesController;admin:SalesAdminController;automation:AutomationController;machineAuth:MachineAuthService }
export const salesRoutes:FastifyPluginAsync<Options>=async(app,{controller,admin,automation,machineAuth})=>{
  app.decorateRequest("machineAuthContext",null);
  app.post("/bot/v1/sales/sessions",{preHandler:requireMachineCredential(machineAuth)},controller.open);
  app.post("/bot/v1/sales/inbox",{preHandler:requireMachineCredential(machineAuth)},controller.accept);
  app.post("/conversation/v1/message",controller.message);
  app.put("/conversation/v1/typebot-session",controller.typebotSession);
  app.post("/conversation/v1/evidence",{bodyLimit:2_900_000},controller.evidence);
  app.post("/conversation/v1/evidence/analysis",controller.analyze);
  const preHandler=[requireAuthenticatedUser(app.authService),requireBusinessMembership(app.membershipsRepository),requireBusinessRole(["owner","admin"])];
  app.get("/businesses/:businessId/sales-automation",{preHandler},admin.overview);
  app.put("/businesses/:businessId/sales-automation",{preHandler},admin.configure);
  app.post("/businesses/:businessId/sales-automation/reviewers",{preHandler},admin.reviewer);
  app.delete("/businesses/:businessId/sales-automation/reviewers",{preHandler},admin.removeReviewer);
  app.patch("/businesses/:businessId/sales-automation/sessions/:sessionId",{preHandler},admin.pause);
  app.post("/businesses/:businessId/sales-automation/sessions/:sessionId/resolution",{preHandler},admin.resolve);
  app.post("/businesses/:businessId/sales-automation/checkouts/:checkoutId/complete",{preHandler},admin.complete);
  app.post("/businesses/:businessId/sales-automation/jobs/retry",{preHandler},admin.retry);
  app.post("/automation/v1/:integrationId/tick",automation.tick);
  app.post("/automation/v1/:integrationId/inbox/claim",automation.claimInbox);
  app.post("/automation/v1/:integrationId/inbox/ack",automation.finishInbox);
  app.post("/automation/v1/:integrationId/notifications/claim",automation.claim);
  app.post("/automation/v1/:integrationId/notifications/ack",automation.ack);
  app.post("/webhooks/telegram/:integrationId",automation.webhook);
};
