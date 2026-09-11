import type { JsonObject } from "../integrations/integrations.types.js";

export const conversationStates = [
  "WELCOME",
  "MAIN_MENU",
  "CATEGORY_SELECTION",
  "SUBCATEGORY_SELECTION",
  "PRODUCT_SELECTION",
  "QUANTITY_SELECTION",
  "COLLECTING_REQUIRED_INPUT",
  "REVIEW",
  "PAYMENT_METHOD_SELECTION",
  "PAYMENT_PENDING",
  "ORDER_STATUS",
  "FAQ",
  "SUPPORT",
  "HUMAN_HANDOFF",
] as const;

export type ConversationState = (typeof conversationStates)[number];

/** El backend decide qué espera del cliente; Typebot solo lo respeta. */
export type ConversationExpectation = "button" | "text" | "media" | "none";

export interface ConversationTurnInput {
  remoteJid: string;
  messageId?: string | undefined;
  buttonId?: string | undefined;
  text?: string | undefined;
  media?: string | undefined;
}

export interface ConversationSession {
  id: string;
  businessId: string;
  remoteJid: string;
  customerId: string | null;
  state: ConversationState;
  payload: ConversationPayload;
  page: number;
  handoff: boolean;
}

export interface ConversationPayload {
  categoryId?: string;
  categoryPath?: string[];
  categoryName?: string;
  productId?: string;
  productName?: string;
  quantityOptionId?: string;
  quantity?: number;
  /** Campos requeridos del producto aún no resueltos, en orden. */
  pendingFields?: string[];
  currentFieldKey?: string;
  collectedInputs?: Record<string, string>;
  quoteId?: string;
  quoteTotal?: number;
  quoteCurrency?: string;
  orderId?: string;
  paymentId?: string;
  checkoutUrl?: string;
  /** Listado paginado activo: qué colección está navegando el cliente. */
  listing?: "categories" | "products" | "orders" | "payment-methods";
}

export interface ConversationTurnResponse {
  state: ConversationState;
  /** Texto humano, sin markup. */
  message: string;
  /** Texto final listo para WhatsApp (con markup de botones si aplica). */
  renderedMessage: string;
  expect: ConversationExpectation;
}

export type ConversationStoredTurn = ConversationTurnResponse;

export interface CategoryNode {
  id: string;
  name: string;
  parentId: string | null;
}

export interface ProductNode {
  id: string;
  name: string;
  description: string | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  requiredInputs: Array<{
    key: string;
    label: string;
    type: "url" | "text" | "textarea" | "integer" | "date";
    required: boolean;
    validation: JsonObject;
  }>;
}

export interface OrderSummary {
  id: string;
  status: string;
  total: number;
  currency: string;
  createdAt: string;
}

export interface ConversationAiAssistant {
  /** Respuesta conversacional (bienvenida, FAQ, soporte). `null` degrada a fallback. */
  reply(input: {
    businessId: string;
    message: string;
    customerId: string | null;
    conversationId: string;
    context: Record<string, unknown>;
  }): Promise<{ message: string; action: string } | null>;
}
