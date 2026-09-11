import type { FastifyRequest } from "fastify";
import { AppError } from "../../core/errors/app-error.js";
import type { AutomationService } from "./automation.service.js";
import type { AutomationAccessService } from "./automation-access.service.js";
import type { PostgresNotificationsRepository } from "./notifications.repository.js";
import type { TelegramService } from "../../integrations/telegram/telegram.service.js";
import { ackSchema,telegramSchema,uuid,validated,inboxAckSchema } from "../sales/sales.schema.js";
import type { SalesInboxService } from "../sales/sales-inbox.service.js";
export class AutomationController {
  constructor(private readonly service:AutomationService,private readonly access:AutomationAccessService,
    private readonly notifications:PostgresNotificationsRepository,private readonly telegram:TelegramService,private readonly inbox:SalesInboxService) {}
  private integration(request:FastifyRequest) { return validated(uuid,(request.params as {integrationId:string}).integrationId); }
  private business(request:FastifyRequest) { return this.access.authenticate(this.integration(request),request.headers.authorization); }
  tick=async(request:FastifyRequest)=>this.service.tick(await this.business(request));
  claim=async(request:FastifyRequest)=>({items:await this.service.claim(await this.business(request))});
  claimInbox=async(request:FastifyRequest)=>({items:await this.inbox.claim(await this.business(request))});
  finishInbox=async(request:FastifyRequest)=>{
    const businessId=await this.business(request);const body=validated(inboxAckSchema,request.body);
    return this.inbox.finish(businessId,body.id,body.lease,body.text);
  };
  ack=async(request:FastifyRequest)=>{
    const businessId=await this.business(request); const body=validated(ackSchema,request.body);
    if (!await this.notifications.finish(businessId,body.id,body.lease,body.success)) throw new AppError("Entrega vencida o ya confirmada",409,"NOTIFICATION_LEASE_EXPIRED");
    return {ok:true};
  };
  webhook=async(request:FastifyRequest)=>this.telegram.receive(this.integration(request),request.headers["x-telegram-bot-api-secret-token"],validated(telegramSchema,request.body));
}
