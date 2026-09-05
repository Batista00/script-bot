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
  mode: "provider" | "manual";
  productId: string;
  mappingId: string | null;
  providerServiceId: string | null;
  input: JsonObject;
}
export interface SalesState {
  optedOut?: boolean;
  phase?: "browse" | "quantity" | "inputs" | "confirm" | "payment" | "awaiting";
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
  text: string;
  advice?: { instructions: string; question: string };
  paused?: boolean;
}
export interface SalesMessage { messageId: string; text: string }
