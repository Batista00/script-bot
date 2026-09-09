import type { BotProductDto } from "../bot-gateway/bot-gateway.types.js";
import type { JsonObject } from "../integrations/integrations.types.js";

export interface SalesSettings {
  enabled: boolean;
  displayName: string;
  welcome: string;
  policies: string;
  humanContact: string;
  telegramChatId: string;
  autoDispatch: boolean;
  evidenceRetentionDays: number;
}
export const defaultSalesSettings: SalesSettings = {
  enabled: false, displayName: "Asistente de ventas", welcome: "¡Hola! ¿En qué puedo ayudarte?",
  policies: "", humanContact: "", telegramChatId: "", autoDispatch: false, evidenceRetentionDays: 30,
};
export interface DeliverySnapshot {
  items?: Array<DeliverySnapshot & {quantity:number}>;
  physical?: import("../products/physical-delivery.js").PhysicalDelivery;
  mode: "provider" | "manual" | "digital";
  digitalContents?:import("../digital-delivery/digital-delivery.schema.js").DigitalContents;
  productId: string;
  mappingId: string | null;
  providerServiceId: string | null;
  input: JsonObject;
}
export interface CartSelection {product:BotProductDto;quantity:number;input:JsonObject;deliverySelection?:import("../products/physical-delivery.js").DeliverySelection}
export interface SalesState {
  cart?: CartSelection[];
  deliverySelection?: import("../products/physical-delivery.js").DeliverySelection;
  categoryId?: string;
  categoryChoices?: Array<{id:string;name:string;parentId:string|null}>;
  greeted?: boolean;
  previousInputs?: JsonObject;
  optedOut?: boolean;
  phase?: "browse" | "quantity" | "inputs" | "delivery" | "confirm" | "payment" | "awaiting";
  offset?: number;
  search?: string;
  termGroups?: string[][];
  choices?: BotProductDto[];
  choiceQuantities?: Array<number | null>;
  choiceLabels?: string[];
  product?: BotProductDto;
  quantity?: number;
  input?: JsonObject;
  checkoutId?: string;
  paymentChoices?: string[];
  humanResolutions?: Array<{
    outcome: "sale_completed" | "no_sale" | "follow_up" | "other";
    note: string;
    resolvedAt: string;
    resolvedBy: string;
  }>;
}
export interface SalesSession {
  id: string; businessId: string; customerId: string; contact: string;
  state: SalesState; paused: boolean; typebotSessionId: string | null;
}
export interface SalesCheckout {
  id: string; businessId: string; sessionId: string; quoteId: string;
  orderId: string | null; paymentId: string | null; delivery: DeliverySnapshot;
  lastOrderStatus: string | null; attentionCode: string | null;
}
export interface SalesReply {
  summaryText?:string;
  catalogText?: string;
  text: string;
  context?: ReturnType<typeof import("./sales-context.js").salesContext>;
  advice?: { instructions: string; question: string };
  paused?: boolean;
}
export interface SalesMessage { messageId: string; text: string; presentation?: "typebot" | undefined; decision?: import("./sales-agent-actions.js").AgentDecision | undefined }
