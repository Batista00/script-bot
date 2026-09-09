import { z } from "zod";
export const digitalAssetInputSchema=z.object({kind:z.enum(["download","license"]),label:z.string().trim().min(1).max(120),value:z.string().trim().min(1).max(2048)}).strict().superRefine((value,ctx)=>{
  if(value.kind==="download"){
    try{const url=new URL(value.value);if(url.protocol!=="https:"||url.username||url.password)throw new Error();}
    catch{ctx.addIssue({code:"custom",message:"Use an HTTPS download link without embedded credentials"});}
  }
});
export const digitalAssetStatusSchema=z.object({status:z.enum(["active","inactive"])}).strict();
export type DigitalAssetInput=z.infer<typeof digitalAssetInputSchema>;
export type DigitalContents="downloads"|"licenses"|"both";
export interface DigitalOrderItem {productId:string;productName:string;quantity:number;contents:DigitalContents}
export interface AssetReference {id:string;productName:string}
export interface DigitalAllocation {id:string;orderId:string;assets:AssetReference[]}
