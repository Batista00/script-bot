export const aiIntents = [
  "greeting",
  "buy_product",
  "browse_products",
  "ask_price",
  "payment_methods",
  "payment_status",
  "order_status",
  "faq",
  "human_handoff",
  "unknown",
  "bundle_purchase",
  "multi_target_purchase",
] as const;

export type AiIntent = (typeof aiIntents)[number];

export const aiPlatforms = [
  "instagram",
  "facebook",
  "youtube",
  "tiktok",
] as const;

export type AiPlatform = (typeof aiPlatforms)[number];

export const aiServices = [
  "followers",
  "likes",
  "views",
  "comments",
  "live_views",
] as const;

export type AiService = (typeof aiServices)[number];

export interface AiEntities {
  platform: AiPlatform | null;
  service: AiService | null;
  quantity: number | null;
  urls: string[];
  paymentMethod: string | null;
}

export interface AiInterpretation {
  intent: AiIntent;
  confidence: number;
  entities: AiEntities;
}

export interface AiInterpreter {
  isConfigured(): boolean;
  interpret(input: { message: string }): Promise<AiInterpretation>;
}

export interface AiAssistantRequest {
  message: string;
  customerId?: string | null | undefined;
  conversationId?: string | null | undefined;
  context?: Record<string, unknown> | undefined;
}

export type AiAssistantAction =
  | "reply"
  | "show_products"
  | "show_payment_methods"
  | "show_payment_status"
  | "show_order_status"
  | "handoff"
  | "clarify";

export interface AiAssistantResponse {
  intent: AiIntent;
  confidence: number;
  message: string;
  action: AiAssistantAction;
  data: Record<string, unknown>;
  missingFields: string[];
}

export interface AiInterpretInput {
  message: string;
}
