import type { FastifyRequest } from "fastify";
import { AppError } from "../../core/errors/app-error.js";
import { shippingQuoteSchema,type SalesShippingQuoteService } from "./sales-shipping-quote.service.js";
import type { SalesAdminService } from "./sales-admin.service.js";
import { humanResolutionSchema,manualSchema,pauseSchema,reviewerSchema,settingsSchema,uuid,validated,retryJobSchema } from "./sales.schema.js";
export class SalesAdminController {
  constructor(private readonly service:SalesAdminService,private readonly shipping?:SalesShippingQuoteService) {}
  private business(request:FastifyRequest) { return validated(uuid,(request.params as {businessId:string}).businessId); }
  overview=async(request:FastifyRequest)=>this.service.overview(this.business(request));
  shippingQuote=async(request:FastifyRequest)=>{
    if(!this.shipping)throw new AppError("Cotización de envío no configurada",409,"DELIVERY_NOT_CONFIGURED");
    return this.shipping.quote(this.business(request),validated(uuid,(request.params as {sessionId:string}).sessionId),request.authenticatedUser!.id,validated(shippingQuoteSchema,request.body));
  };
  configure=async(request:FastifyRequest)=>this.service.configure(this.business(request),validated(settingsSchema,request.body));
  reviewer=async(request:FastifyRequest)=>this.service.bindReviewer(this.business(request),validated(reviewerSchema,request.body).telegramUserId,request.authenticatedUser!.id);
  removeReviewer=async(request:FastifyRequest)=>this.service.unbindReviewer(this.business(request),validated(reviewerSchema,request.body).telegramUserId);
  pause=async(request:FastifyRequest)=>this.service.pause(this.business(request),validated(uuid,(request.params as {sessionId:string}).sessionId),validated(pauseSchema,request.body).paused);
  resolve=async(request:FastifyRequest)=>this.service.resolveHumanHandoff(this.business(request),validated(uuid,(request.params as {sessionId:string}).sessionId),request.authenticatedUser!.id,validated(humanResolutionSchema,request.body));
  complete=async(request:FastifyRequest)=>this.service.completeManual(this.business(request),validated(uuid,(request.params as {checkoutId:string}).checkoutId),request.authenticatedUser!.id,validated(manualSchema,request.body).note);
  retry=async(request:FastifyRequest)=>{
    const body=validated(retryJobSchema,request.body);
    return this.service.retryJob(this.business(request),body.kind,body.id);
  };
}
