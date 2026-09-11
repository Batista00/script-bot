import { z } from "zod";
import { AppError } from "../../core/errors/app-error.js";
import type { SalesReply, SalesSession } from "./sales.types.js";
import type { BotProductDto } from "../bot-gateway/bot-gateway.types.js";
import type { SalesCheckoutService } from "./sales-checkout.service.js";
import { validateCommercialInput } from "../products/product-inputs.js";
import { deliverySelectionSchema } from "../products/physical-delivery.js";
import { addCartItem,removeCartItem } from "./sales-cart.js";

export const agentDecisionSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("catalog"),search:z.string().trim().max(160)}).strict(),
  z.object({action:z.literal("select"),productId:z.string().uuid(),quantity:z.number().int().positive().max(2147483647)}).strict(),
  z.object({action:z.literal("input"),value:z.string().min(1).max(10000)}).strict(),
  z.object({action:z.literal("confirm")}).strict(),
  z.object({action:z.literal("delivery"),selection:deliverySelectionSchema}).strict(),
  z.object({action:z.literal("payment"),methodId:z.string().uuid()}).strict(),
  z.object({action:z.literal("status")}).strict(),
  z.object({action:z.literal("new_purchase")}).strict(),
  z.object({action:z.literal("add_item")}).strict(),
  z.object({action:z.literal("remove_item"),productId:z.string().uuid()}).strict(),
  z.object({action:z.literal("handoff"),reason:z.string().trim().min(1).max(1000)}).strict(),
]);
export type AgentDecision=z.infer<typeof agentDecisionSchema>;
interface Operations {
  catalog:(search:string)=>Promise<SalesReply>;
  select:(product:BotProductDto,quantity:number)=>Promise<SalesReply>;
  input:(value:string)=>Promise<SalesReply>;
  handoff:(reason:string)=>Promise<SalesReply>;
  reset:()=>Promise<SalesReply>;
}

/** The model proposes intent; only these existing deterministic operations can change a sale. */
export async function executeAgentDecision(session:SalesSession,decision:AgentDecision,checkout:SalesCheckoutService,ops:Operations):Promise<SalesReply> {
  const phase=session.state.phase??"browse";
  const requirePhase=(...allowed:string[])=>{if(!allowed.includes(phase))throw new AppError("Ese paso todavía no corresponde. Conservamos la compra actual",409,"SALES_STEP_NOT_ALLOWED");};
  switch(decision.action){
    case "catalog": requirePhase("browse");return ops.catalog(decision.search);
    case "select": {
      requirePhase("browse");
      const product=session.state.choices?.find(p=>p.productId===decision.productId);
      if(!product)throw new AppError("Consulta primero las opciones actuales del negocio",409,"SALES_SELECTION_REQUIRED");
      if(decision.quantity<(product.minQuantity??1)||decision.quantity>(product.maxQuantity??2147483647))throw new AppError("Cantidad fuera del rango del producto",400,"INVALID_PRODUCT_QUANTITY");
      return ops.select(product,decision.quantity);
    }
    case "input": {
      requirePhase("inputs","quantity");
      if(phase==="inputs"){
        const field=session.state.product?.requiredInputs.find(f=>!(f.key in (session.state.input??{})));
        if(field)validateCommercialInput([field],{[field.key]:field.type==="integer"?Number(decision.value):decision.value});
      }
      return ops.input(decision.value);
    }
    case "confirm":requirePhase("confirm");return checkout.confirm(session);
    case "delivery":
      requirePhase("delivery");
      session.state.deliverySelection=decision.selection;
      return checkout.quote(session);
    case "payment":requirePhase("payment");return checkout.pay(session,decision.methodId);
    case "status":return checkout.status(session);
    case "new_purchase":
      // Inactivity already closed the selection. checkoutId is retained for
      // tracking the old order, not to make its payment block a fresh purchase.
      if(phase!=="browse"||session.state.product||session.state.cart?.length)await checkout.releaseForNewPurchase(session);
      return ops.reset();
    case "add_item":return addCartItem(session,checkout);
    case "remove_item":return removeCartItem(session,decision.productId,checkout);
    case "handoff":return ops.handoff(decision.reason);
  }
}
