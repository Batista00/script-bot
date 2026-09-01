import type { FastifyRequest } from "fastify";
import { AppError } from "../../core/errors/app-error.js";
import type { SalesAccessService } from "./sales-access.service.js";
import type { SalesConversationService } from "./sales-conversation.service.js";
import type { PaymentReviewsService } from "../payment-reviews/payment-reviews.service.js";
import { evidenceSchema,messageSchema,openSessionSchema,validated,inboxSchema,analysisSchema } from "./sales.schema.js";
import type { SalesInboxService } from "./sales-inbox.service.js";

export class SalesController {
  constructor(private readonly access:SalesAccessService,private readonly conversation:SalesConversationService,
    private readonly reviews:PaymentReviewsService,private readonly inbox:SalesInboxService) {}
  accept=async(request:FastifyRequest)=>this.inbox.accept(request.machineAuthContext!.businessId,validated(inboxSchema,request.body));
  open=async(request:FastifyRequest)=>{
    const body=validated(openSessionSchema,request.body);
    if (!request.machineAuthContext) throw new AppError("Credencial requerida",401,"MACHINE_AUTHENTICATION_REQUIRED");
    return this.access.open(request.machineAuthContext.businessId,body.contact,body.name);
  };
  message=async(request:FastifyRequest)=>{
    const context=await this.access.authenticate(request.headers.authorization);
    return this.conversation.receive(context.businessId,context.sessionId,validated(messageSchema,request.body));
  };
  evidence=async(request:FastifyRequest)=>{
    const context=await this.access.authenticate(request.headers.authorization);
    return this.reviews.submit(context.businessId,context.sessionId,validated(evidenceSchema,request.body));
  };
  analyze=async(request:FastifyRequest)=>{
    const context=await this.access.authenticate(request.headers.authorization);
    const body=validated(analysisSchema,request.body);
    return this.reviews.annotate(context.businessId,context.sessionId,body.reviewId,body.analysis);
  };
}
