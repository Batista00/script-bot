import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { AppError } from "../../core/errors/app-error.js";
import type { PriceCalculatorService } from "../pricing/price-calculator.service.js";
import { deliverySelectionSchema, deliverySelectionHttpSchema, resolvePhysicalDelivery, type PhysicalDelivery, type ManualShippingQuote } from "../products/physical-delivery.js";
import type { CreateQuoteInput } from "./quotes.types.js";
import type { PricingType } from "../pricing/pricing.types.js";

const lineSchema=z.object({productId:z.string().uuid(),quantity:z.number().int().min(1).max(2147483647),delivery:deliverySelectionSchema.optional()}).strict();
export type QuoteSelection=z.infer<typeof lineSchema>;
export interface QuoteItem {productId:string;productName:string;quantity:number;pricingType:PricingType;unitPrice:number|null;totalPrice:number}

/** Customer input never supplies prices. A separate trusted staff operation can quote shipping. */
export async function calculateQuoteCart(calculator:PriceCalculatorService,businessId:string,input:CreateQuoteInput,manualShipping?:ManualShippingQuote) {
  if(!Number.isInteger(input.quantity)||input.quantity<=0||input.quantity>2147483647)throw new AppError("Quantity must be a positive integer",400,"INVALID_QUOTE_QUANTITY");
  const parsed=z.array(lineSchema).min(1).max(10).safeParse([
    {productId:input.productId,quantity:input.quantity,...(input.delivery?{delivery:input.delivery}:{})},...(input.additionalItems??[]),
  ]);
  if(!parsed.success)throw new AppError("Revisa los productos, cantidades y entregas del carrito",400,"INVALID_QUOTE_ITEMS");
  if(new Set(parsed.data.map(i=>i.productId)).size!==parsed.data.length)throw new AppError("Un producto no puede repetirse; modifica su cantidad",400,"DUPLICATE_CART_PRODUCT");
  const items:QuoteItem[]=[];let delivery:PhysicalDelivery|null=null,currency=input.currency;
  for(const selection of parsed.data){
    const price=await calculator.calculate(businessId,selection.productId,selection.quantity,input.currency);
    currency=price.currency;
    const shipping=resolvePhysicalDelivery(price.deliveryConfig,selection.delivery,manualShipping);
    if(shipping){
      if(delivery&&!isDeepStrictEqual(delivery,shipping))throw new AppError("Las entregas del carrito tienen condiciones distintas. Un agente debe unificar el despacho antes de pagar",409,"CART_DELIVERY_REQUIRES_REVIEW");
      delivery=shipping; // Identical home delivery is charged once for the whole order.
    }
    items.push({productId:price.productId,productName:price.productName,quantity:selection.quantity,pricingType:price.pricingType,unitPrice:price.unitPrice,totalPrice:price.totalPrice});
  }
  const subtotal=items.reduce((sum,item)=>sum+item.totalPrice,0),totalPrice=subtotal+(delivery?.fee??0);
  if(!Number.isSafeInteger(totalPrice))throw new AppError("El total supera el máximo admitido",400,"INVALID_QUOTE_TOTAL");
  return {items,delivery,totalPrice,currency};
}
export const additionalItemsHttpSchema={type:"array",minItems:1,maxItems:9,items:{type:"object",additionalProperties:false,required:["productId","quantity"],properties:{
  productId:{type:"string",format:"uuid"},quantity:{type:"integer",minimum:1,maximum:2147483647},delivery:deliverySelectionHttpSchema,
}}} as const;
export const quoteItemsHttpSchema={type:"array",minItems:1,maxItems:10,items:{type:"object",additionalProperties:false,required:["productId","productName","quantity","pricingType","unitPrice","totalPrice"],properties:{
  productId:{type:"string",format:"uuid"},productName:{type:"string"},quantity:{type:"integer"},pricingType:{type:"string",enum:["fixed","unit"]},
  unitPrice:{anyOf:[{type:"integer"},{type:"null"}]},totalPrice:{type:"integer"},
}}} as const;
