import type { FastifyRequest } from "fastify";
import { uuid,validated } from "../sales/sales.schema.js";
import { digitalAssetInputSchema,digitalAssetStatusSchema } from "./digital-delivery.schema.js";
import type { DigitalDeliveryService } from "./digital-delivery.service.js";
export class DigitalDeliveryController {
  constructor(private readonly service:DigitalDeliveryService){}
  private ids(request:FastifyRequest){const p=request.params as {businessId:string;productId:string};return {businessId:validated(uuid,p.businessId),productId:validated(uuid,p.productId)};}
  list=async(request:FastifyRequest)=>{const {businessId,productId}=this.ids(request);return this.service.list(businessId,productId);};
  add=async(request:FastifyRequest)=>{const {businessId,productId}=this.ids(request);return this.service.add(businessId,productId,validated(digitalAssetInputSchema,request.body));};
  status=async(request:FastifyRequest)=>{const {businessId,productId}=this.ids(request);return this.service.status(businessId,productId,validated(uuid,(request.params as {assetId:string}).assetId),validated(digitalAssetStatusSchema,request.body).status);};
}
