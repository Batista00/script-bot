import type { FastifyRequest } from "fastify";
import type { SalesAdminService } from "./sales-admin.service.js";
import { manualSchema,pauseSchema,reviewerSchema,settingsSchema,uuid,validated,retryJobSchema } from "./sales.schema.js";
export class SalesAdminController {
  constructor(private readonly service:SalesAdminService) {}
  private business(request:FastifyRequest) { return validated(uuid,(request.params as {businessId:string}).businessId); }
  overview=async(request:FastifyRequest)=>this.service.overview(this.business(request));
  configure=async(request:FastifyRequest)=>this.service.configure(this.business(request),validated(settingsSchema,request.body));
  reviewer=async(request:FastifyRequest)=>this.service.bindReviewer(this.business(request),validated(reviewerSchema,request.body).telegramUserId,request.authenticatedUser!.id);
  removeReviewer=async(request:FastifyRequest)=>this.service.unbindReviewer(this.business(request),validated(reviewerSchema,request.body).telegramUserId);
  pause=async(request:FastifyRequest)=>this.service.pause(this.business(request),validated(uuid,(request.params as {sessionId:string}).sessionId),validated(pauseSchema,request.body).paused);
  complete=async(request:FastifyRequest)=>this.service.completeManual(this.business(request),validated(uuid,(request.params as {checkoutId:string}).checkoutId),request.authenticatedUser!.id,validated(manualSchema,request.body).note);
  retry=async(request:FastifyRequest)=>{
    const body=validated(retryJobSchema,request.body);
    return this.service.retryJob(this.business(request),body.kind,body.id);
  };
}
