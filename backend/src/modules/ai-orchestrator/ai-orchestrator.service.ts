import type {
  AiAssistantAction,
  AiAssistantRequest,
  AiAssistantResponse,
  AiIntent,
  AiInterpreter,
  AiInterpretation,
} from "./ai-orchestrator.types.js";

function actionFor(intent: AiIntent): AiAssistantAction {
  switch (intent) {
    case "buy_product":
    case "browse_products":
    case "ask_price":
      return "show_products";

    case "payment_methods":
      return "show_payment_methods";

    case "payment_status":
      return "show_payment_status";

    case "order_status":
      return "show_order_status";

    case "human_handoff":
      return "handoff";

    case "unknown":
    case "bundle_purchase":
    case "multi_target_purchase":
      return "clarify";

    default:
      return "reply";
  }
}

function messageFor(intent: AiIntent): string {
  switch (intent) {
    case "greeting":
      return "¡Hola! ¿Qué servicio estás buscando?";

    case "buy_product":
      return "Voy a buscar opciones disponibles para lo que necesitas.";

    case "browse_products":
      return "Puedo mostrarte nuestros servicios disponibles.";

    case "ask_price":
      return "Voy a revisar las opciones y precios disponibles.";

    case "payment_methods":
      return "Voy a revisar los métodos de pago disponibles.";

    case "payment_status":
      return "Puedo ayudarte a revisar el estado de tu pago.";

    case "order_status":
      return "Puedo ayudarte a revisar el estado de tu pedido.";

    case "human_handoff":
      return "Te derivaré con un agente.";

    case "bundle_purchase":
      return "Entendí que buscas un paquete o promoción.";

    case "multi_target_purchase":
      return "Entendí que quieres distribuir el servicio.";

    case "faq":
      return "Claro, puedo ayudarte con esa consulta.";

    default:
      return "Indícame la red social y el servicio que necesitas.";
  }
}

function missingFields(value: AiInterpretation): string[] {
  const missing: string[] = [];

  if (value.intent === "buy_product" || value.intent === "ask_price") {
    if (!value.entities.platform) missing.push("platform");
    if (!value.entities.service) missing.push("service");
  }

  return missing;
}

export class AiOrchestratorService {
  constructor(private readonly interpreter: AiInterpreter) {}

  async handle(
    businessId: string,
    input: AiAssistantRequest,
  ): Promise<AiAssistantResponse> {
    void businessId;

    if (!this.interpreter.isConfigured()) {
      return {
        intent: "unknown",
        confidence: 0,
        message: "Indícame la red social y el servicio que necesitas.",
        action: "clarify",
        data: { aiConfigured: false },
        missingFields: [],
      };
    }

    const result = await this.interpreter.interpret({
      message: input.message,
    });

    return {
      intent: result.intent,
      confidence: result.confidence,
      message: messageFor(result.intent),
      action: actionFor(result.intent),
      data: {
        aiConfigured: true,
        entities: result.entities,
      },
      missingFields: missingFields(result),
    };
  }
}
