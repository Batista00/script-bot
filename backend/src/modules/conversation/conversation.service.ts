import { createHash } from "node:crypto";

import { AppError } from "../../core/errors/app-error.js";
import type { CustomersService } from "../customers/customers.service.js";
import type { OrdersService } from "../orders/orders.service.js";
import type { PaymentMethodsService } from "../payment-methods/payment-methods.service.js";
import type { PaymentsService } from "../payments/payments.service.js";
import type { QuotesService } from "../quotes/quotes.service.js";
import {
  commercialButtonLabel,
  formatCompactAmount,
  MAX_WHATSAPP_BUTTONS,
  pageCapacity,
  paginate,
  renderNumberedMenu,
  renderPlainMessage,
  renderWhatsAppButtons,
} from "./conversation.buttons.js";
import type { PriceCalculatorService } from "../pricing/price-calculator.service.js";
import type { PostgresConversationRepository } from "./conversation.repository.js";
import type {
  ConversationAiAssistant,
  ConversationPayload,
  ConversationSession,
  ConversationState,
  ConversationTurnInput,
  ConversationTurnResponse,
  ProductNode,
} from "./conversation.types.js";

const MAIN_MENU = {
  state: "MAIN_MENU" as ConversationState,
  title: "¿Qué quieres hacer hoy?",
  description: "Elige una opción para comenzar.",
};

/** Textos de negocio: una idea por mensaje, sin jerga técnica. */
const COPY = {
  welcomeFallback: "¡Hola! 👋 Qué gusto saludarte. ¿En qué puedo ayudarte hoy?",
  needButtons: "Para avanzar elige una de las opciones 👇",
  noCategories: "Todavía no hay servicios publicados. Puedes hablar con una persona del equipo.",
  noProducts: "Aún no hay opciones disponibles en esta categoría. ¿Quieres ver otra?",
  noOrders: "No encontramos pedidos asociados a este número.",
  technical: "En este momento no pude consultar esa información. Puedes intentarlo nuevamente en unos segundos.",
  invalidUrl: "Ese enlace no parece válido. Envíame la URL completa, por favor.",
  invalidValue: "No pude leer ese dato. Envíamelo nuevamente, por favor.",
  handoff: "Listo 🙋 Una persona del equipo continuará la conversación por este mismo chat.",
  support: "Estoy aquí para ayudarte. Cuéntame tu consulta o elige una opción.",
  faq: "Claro 😊 Pregúntame lo que necesites sobre nuestros servicios.",
  paymentInfo: "Aceptamos Mercado Pago (pago con tarjeta o saldo) y transferencia bancaria con comprobante. Al confirmar tu compra te muestro las opciones disponibles.",
  cancelled: "Listo, cancelamos esta compra. Cuando quieras empezamos de nuevo.",
} as const;

/**
 * Estado comercial -> experiencia a presentar. El router de Typebot enruta por
 * `view`; el estado sigue siendo el del negocio.
 */
const VIEW_BY_STATE: Record<string, string> = {
  COLLECTING_REQUIRED_INPUT: "REQUIRED_INPUT",
};

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "🟡 Esperando tu pago",
  paid: "🟢 Pago confirmado",
  processing: "🔵 En procesamiento",
  completed: "✅ Completado",
  partial: "🟠 Completado parcialmente",
  cancelled: "⚪ Cancelado",
  failed: "🔴 Con problema",
};

/** Importes legibles para el cliente (sin exponer detalles internos). */
export function formatAmount(amount: number | null | undefined, currency: string): string {
  if (amount === null || amount === undefined) return "—";
  const formatted = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(amount);
  return `$${formatted} ${currency}`;
}

/** Opciones de cantidad definidas por el backend, nunca por el cliente. */
export function quantityOptionsFor(product: Pick<ProductNode, "minQuantity" | "maxQuantity">): number[] {
  const min = product.minQuantity ?? null;
  const max = product.maxQuantity ?? null;
  if (min !== null && max !== null && min === max) return [min];
  const candidates: number[] = [];
  const base = min ?? 1;
  for (const factor of [1, 2, 5, 10]) {
    const value = base * factor;
    if (max !== null && value > max) break;
    if (!candidates.includes(value)) candidates.push(value);
  }
  if (candidates.length === 0 && max !== null) candidates.push(max);
  if (candidates.length === 0) candidates.push(1);
  return candidates;
}

function digitsFromRemoteJid(remoteJid: string): string | null {
  const local = remoteJid.split("@")[0]?.split(":")[0] ?? "";
  const digits = local.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidInteger(value: string): boolean {
  return /^\d{1,12}$/.test(value.trim());
}

function isValidDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value.trim()));
}

export interface ConversationServiceDeps {
  repository: PostgresConversationRepository;
  customers: CustomersService;
  quotes: QuotesService;
  orders: OrdersService;
  payments: PaymentsService;
  paymentMethods: PaymentMethodsService;
  pricing: PriceCalculatorService;
  ai?: ConversationAiAssistant | undefined;
}

/**
 * Orquestador conversacional: única autoridad sobre el avance de la venta.
 *
 * Recibe un turno (botón pulsado, texto libre o comprobante) y ejecuta
 * exactamente UNA transición. Typebot no interpreta nada: muestra el
 * `renderedMessage` que devuelve este servicio y vuelve a llamar.
 */
export class ConversationService {
  constructor(private readonly deps: ConversationServiceDeps) {}

  async handleTurn(businessId: string, input: ConversationTurnInput): Promise<ConversationTurnResponse> {
    const remoteJid = input.remoteJid.trim();
    if (remoteJid.length === 0) {
      throw new AppError("remoteJid is required", 400, "CONVERSATION_REMOTE_JID_REQUIRED");
    }
    const existing = await this.deps.repository.findSession(businessId, remoteJid);
    const session = existing ?? await this.startSession(businessId, remoteJid);

    // La huella incluye el estado: el mismo texto ("1") en pasos distintos es
    // una decisión nueva, no un evento duplicado.
    const dedupeKey = this.dedupeKeyFor(remoteJid, input, session.state);
    const cached = await this.deps.repository.findTurn(businessId, dedupeKey);
    if (cached) return cached;
    const response = await this.transition(businessId, session, input);
    if (response.lastOptions && response.lastOptions.length > 0) {
      const current = await this.deps.repository.findSession(businessId, remoteJid);
      if (current) {
        await this.deps.repository.saveSession({
          businessId, remoteJid, customerId: current.customerId, state: current.state,
          payload: { ...current.payload, lastOptions: response.lastOptions },
          page: current.page, handoff: current.handoff,
        });
      }
    }
    await this.deps.repository.saveTurn(businessId, remoteJid, dedupeKey, response);
    return response;
  }

  /**
   * Deduplicación: `messageId` real cuando Evolution lo entrega; si no, una
   * huella estable del payload entrante en una ventana corta. Las operaciones
   * mutantes conservan además su propia idempotencia (conversión de quote,
   * `Idempotency-Key` de pago).
   */
  private dedupeKeyFor(remoteJid: string, input: ConversationTurnInput, state: string): string {
    const messageId = input.messageId?.trim();
    if (messageId && messageId.length >= 8) return `msg:${messageId.slice(0, 160)}`;
    const fingerprint = createHash("sha256")
      .update([remoteJid, state, input.buttonId ?? "", input.text ?? "", input.media ?? ""].join("\u0000"))
      .digest("hex")
      .slice(0, 40);
    return `fp:${fingerprint}`;
  }

  private async startSession(businessId: string, remoteJid: string): Promise<ConversationSession> {
    const phone = digitsFromRemoteJid(remoteJid);
    let customerId: string | null = null;
    if (phone) {
      try {
        const customer = await this.deps.customers.resolve(businessId, { phone });
        customerId = customer.id;
      } catch {
        customerId = null;
      }
    }
    return this.deps.repository.saveSession({
      businessId,
      remoteJid,
      customerId,
      state: "WELCOME",
      payload: {},
      page: 0,
      handoff: false,
    });
  }

  /** Precio real del pricing core; null si aún no hay precio publicado. */
  private async priceFor(
    businessId: string,
    productId: string,
    quantity: number,
    currency: string,
  ): Promise<number | null> {
    try {
      const calculation = await this.deps.pricing.calculate(businessId, productId, quantity, currency);
      return calculation.totalPrice;
    } catch {
      return null;
    }
  }

  private async persist(
    session: ConversationSession,
    state: ConversationState,
    payload: ConversationPayload,
    patch: { page?: number; handoff?: boolean } = {},
  ): Promise<ConversationSession> {
    return this.deps.repository.saveSession({
      businessId: session.businessId,
      remoteJid: session.remoteJid,
      customerId: session.customerId,
      state,
      payload,
      page: patch.page ?? 0,
      handoff: patch.handoff ?? session.handoff,
    });
  }

  private response(
    state: ConversationState,
    message: string,
    options: {
      view?: string;
      title?: string;
      description?: string;
      footer?: string;
      replies?: Array<{ id: string; label: string }>;
      urlButtons?: Array<{ url: string; label: string }>;
      expect?: ConversationTurnResponse["expect"];
      aiComposed?: boolean;
    } = {},
  ): ConversationTurnResponse {
    const replies = options.replies ?? [];
    const urlButtons = options.urlButtons ?? [];
    const offered = [...replies, ...urlButtons.map((button) => ({ id: button.url, label: button.label }))];
    const hasButtons = offered.length > 0;
    // El canal actual (Evolution 2.3.4 + el cliente de WhatsApp) no renderiza
    // botones nativos, así que la experiencia se presenta como menú enumerado y
    // el backend resuelve el número respondido. El markup de botones queda
    // disponible en `buttonPayload` para cuando el canal pueda mostrarlo.
    let renderedMessage = renderPlainMessage(message);
    let buttonPayload: string | undefined;
    if (hasButtons) {
      buttonPayload = renderWhatsAppButtons({
        title: options.title ?? message,
        description: options.description ?? message,
        ...(options.footer === undefined ? {} : { footer: options.footer }),
        replies,
        urlButtons,
      });
      renderedMessage = renderNumberedMenu(message, offered);
    }
    return {
      state,
      view: (options.view ?? VIEW_BY_STATE[state] ?? state) as ConversationTurnResponse["view"],
      message,
      renderedMessage,
      ...(buttonPayload === undefined ? {} : { buttonPayload }),
      ...(hasButtons ? { lastOptions: offered } : {}),
      expect: options.expect ?? (hasButtons ? "button" : "text"),
      textSource: options.aiComposed === true ? "backend_ai" : "typebot_ai",
    };
  }

  /** Botones de navegación reutilizables. Nunca se degradan a texto. */
  private navigationReplies(options: { back?: boolean; home?: boolean; next?: boolean } = {}) {
    const replies: Array<{ id: string; label: string }> = [];
    if (options.next) replies.push({ id: "navigation.next", label: "Más opciones" });
    if (options.back) replies.push({ id: "navigation.back", label: "Volver" });
    if (options.home) replies.push({ id: "navigation.home", label: "Menú" });
    return replies;
  }

  private async transition(
    businessId: string,
    session: ConversationSession,
    input: ConversationTurnInput,
  ): Promise<ConversationTurnResponse> {
    // Evolution entrega el botón pulsado como texto del mensaje (el `id`), así
    // que aquí se reconoce el prefijo semántico y se trata como botón.
    const raw = (input.buttonId ?? input.text ?? "").trim();
    const isButton = /^(menu\.|help\.|category:|product:|quantity:|checkout\.|payment:|order|navigation\.)/.test(raw);
    let buttonId = isButton ? raw : (input.buttonId?.trim() ?? "");
    const text = isButton ? (input.buttonId ? (input.text?.trim() ?? "") : "") : (input.text?.trim() ?? "");
    // Respuesta numérica del menú: se resuelve con la última oferta presentada
    // por el backend (nunca se confía en el número por sí solo).
    if (buttonId === "" && /^[0-9]{1,2}$/.test(text)) {
      const offered = session.payload.lastOptions ?? [];
      const chosen = offered[Number(text) - 1];
      if (chosen) return this.transition(businessId, session, { ...input, buttonId: chosen.id, text: undefined });
    }

    // Navegación transversal: siempre disponible y siempre determinista.
    if (buttonId === "navigation.retry") {
      const again = await this.renderCurrentView(businessId, session);
      return { ...again, view: "NAVIGATION" };
    }
    if (buttonId.startsWith("navigation.")) {
      const destination = buttonId === "navigation.home"
        ? await this.renderMainMenu(businessId, session)
        : buttonId === "navigation.back"
          ? await this.goBack(businessId, session)
          : await this.nextPage(businessId, session);
      return { ...destination, view: "NAVIGATION" };
    }

    if (buttonId.startsWith("menu.")) return this.handleMenu(businessId, session, buttonId);
    if (buttonId.startsWith("help.")) return this.handleHelp(businessId, session, buttonId);
    if (buttonId.startsWith("category:")) return this.openCategory(businessId, session, buttonId.slice(9));
    if (buttonId.startsWith("product:")) return this.openProduct(businessId, session, buttonId.slice(8));
    if (buttonId.startsWith("quantity:")) return this.selectQuantity(businessId, session, buttonId.slice(9));
    if (buttonId.startsWith("checkout.")) return this.handleCheckout(businessId, session, buttonId);
    if (buttonId.startsWith("payment:")) return this.selectPaymentMethod(businessId, session, buttonId.slice(8));
    if (buttonId === "payment.confirm_transfer") return this.confirmTransfer(businessId, session);
    if (buttonId.startsWith("order:")) return this.showOrder(businessId, session, buttonId.slice(6));
    if (buttonId === "order.refresh") return this.showOrder(businessId, session, session.payload.orderId ?? "");

    // Sin botón reconocido: texto libre.
    if (input.media) return this.handleMedia(businessId, session, input.media);

    if (session.state === "COLLECTING_REQUIRED_INPUT") {
      return this.collectField(businessId, session, text);
    }
    if (session.state === "FAQ" || session.state === "SUPPORT") {
      return this.conversationalReply(businessId, session, text);
    }
    if (text.length === 0) return this.renderMainMenu(businessId, session);

    // Texto libre fuera de captura: la IA conversa y conduce al flujo ordenado.
    return this.conversationalReply(businessId, session, text);
  }

  private async handleMenu(
    businessId: string,
    session: ConversationSession,
    buttonId: string,
  ): Promise<ConversationTurnResponse> {
    switch (buttonId) {
      case "menu.buy":
        return this.openParentCategories(businessId, session, 0);
      case "menu.help":
        return this.renderHelpMenu(businessId, session);
      case "menu.orders":
        return this.openOrders(businessId, session, 0);
      default:
        return this.renderMainMenu(businessId, session);
    }
  }

  private async handleHelp(
    businessId: string,
    session: ConversationSession,
    buttonId: string,
  ): Promise<ConversationTurnResponse> {
    switch (buttonId) {
      case "help.faq":
        await this.persist(session, "FAQ", session.payload);
        return this.response("FAQ", COPY.faq, { view: "FAQ", expect: "text" });
      case "help.payment_info":
        return this.response("SUPPORT", COPY.paymentInfo, {
          view: "SUPPORT",
          title: "Información de pago",
          description: COPY.paymentInfo,
          replies: [
            { id: "menu.buy", label: "Comprar servicios" },
            { id: "help.human", label: "Hablar con alguien" },
            { id: "navigation.home", label: "Menú" },
          ],
        });
      case "help.human":
        await this.persist(session, "HUMAN_HANDOFF", session.payload, { handoff: true });
        return this.response("HUMAN_HANDOFF", COPY.handoff, {
          view: "HUMAN_HANDOFF",
          title: "Atención humana",
          description: COPY.handoff,
          replies: [{ id: "menu.buy", label: "Comprar servicios" }, { id: "navigation.home", label: "Menú" }],
        });
      default:
        return this.renderHelpMenu(businessId, session);
    }
  }

  private async renderHelpMenu(
    businessId: string,
    session: ConversationSession,
  ): Promise<ConversationTurnResponse> {
    await this.persist(session, "SUPPORT", session.payload);
    return this.response("SUPPORT", COPY.support, {
      title: "Ayuda y consultas",
      description: "¿Con qué te ayudo?",
      replies: [
        { id: "help.faq", label: "Preguntas frecuentes" },
        { id: "help.payment_info", label: "Información de pago" },
        { id: "help.human", label: "Hablar con alguien" },
      ],
    });
  }

  private async renderMainMenu(
    businessId: string,
    session: ConversationSession,
  ): Promise<ConversationTurnResponse> {
    const payload: ConversationPayload = { ...session.payload };
    delete payload.currentFieldKey;
    await this.persist(session, "MAIN_MENU", payload);
    return this.response("MAIN_MENU", MAIN_MENU.description, {
      title: MAIN_MENU.title,
      description: MAIN_MENU.description,
      replies: [
        { id: "menu.buy", label: "Comprar servicios" },
        { id: "menu.help", label: "Ayuda y consultas" },
        { id: "menu.orders", label: "Mi pedido" },
      ],
    });
  }

  /** Categorías padre: activas y sin padre. Nunca productos en este nivel. */
  private async openParentCategories(
    businessId: string,
    session: ConversationSession,
    page: number,
  ): Promise<ConversationTurnResponse> {
    const capacity = pageCapacity({ navigationSlots: 1 });
    const offset = page * capacity;
    let categories;
    try {
      categories = await this.deps.repository.listParentCategories(businessId, capacity + 1, offset);
    } catch {
      return this.technicalError(session, "CATEGORY_SELECTION");
    }
    const total = await this.deps.repository.countParentCategories(businessId);
    if (total === 0) {
      await this.persist(session, "MAIN_MENU", session.payload);
      return this.response("MAIN_MENU", COPY.noCategories, {
        title: "Sin servicios",
        description: COPY.noCategories,
        replies: [
          { id: "help.human", label: "Hablar con alguien" },
          { id: "navigation.home", label: "Menú" },
        ],
      });
    }
    const visible = categories.slice(0, capacity);
    const hasNext = total > offset + visible.length;
    const replies = visible.map((category) => ({
      id: `category:${category.id}`,
      label: category.name,
    }));
    replies.push(
      hasNext
        ? { id: "navigation.next", label: "Más opciones" }
        : { id: "navigation.home", label: "Menú" },
    );
    const state: ConversationState = page > 0 ? "SUBCATEGORY_SELECTION" : "CATEGORY_SELECTION";
    await this.persist(
      session,
      state,
      { ...session.payload, listing: "categories" },
      { page },
    );
    return this.response(state, "¿Qué quieres potenciar? 👇", {
      title: "Elige una opción",
      description: "Selecciona la red o el servicio que quieres potenciar.",
      replies,
      ...(hasNext ? { footer: `Página ${page + 1}` } : {}),
    });
  }

  /** Categoría pulsada: si tiene hijas se sigue bajando; si no, aparecen productos. */
  private async openCategory(
    businessId: string,
    session: ConversationSession,
    categoryId: string,
  ): Promise<ConversationTurnResponse> {
    const category = await this.deps.repository.findCategory(businessId, categoryId);
    if (!category) {
      return this.technicalError(session, "CATEGORY_SELECTION");
    }
    const childCount = await this.deps.repository.countChildCategories(businessId, category.id);
    const path = [...(session.payload.categoryPath ?? []), category.id];
    if (childCount > 0) {
      return this.renderChildCategories(businessId, session, category.id, category.name, path, 0);
    }
    return this.renderProducts(businessId, session, category.id, category.name, path, 0);
  }

  private async renderChildCategories(
    businessId: string,
    session: ConversationSession,
    parentId: string,
    parentName: string,
    path: string[],
    page: number,
  ): Promise<ConversationTurnResponse> {
    const capacity = pageCapacity({ navigationSlots: 1 });
    const offset = page * capacity;
    const children = await this.deps.repository.listChildCategories(businessId, parentId, capacity + 1, offset);
    const total = await this.deps.repository.countChildCategories(businessId, parentId);
    const visible = children.slice(0, capacity);
    const hasNext = total > offset + visible.length;
    const replies = visible.map((child) => ({ id: `category:${child.id}`, label: child.name }));
    replies.push(
      hasNext
        ? { id: "navigation.next", label: "Más opciones" }
        : { id: "navigation.back", label: "Volver" },
    );
    await this.persist(
      session,
      "SUBCATEGORY_SELECTION",
      { ...session.payload, categoryId: parentId, categoryName: parentName, categoryPath: path, listing: "categories" },
      { page },
    );
    return this.response("SUBCATEGORY_SELECTION", `${parentName}: ¿qué necesitas? 👇`, {
      title: parentName.slice(0, 60),
      description: "Elige el servicio que quieres potenciar.",
      replies,
    });
  }

  private async renderProducts(
    businessId: string,
    session: ConversationSession,
    categoryId: string,
    categoryName: string,
    path: string[],
    page: number,
  ): Promise<ConversationTurnResponse> {
    const capacity = pageCapacity({ navigationSlots: 1 });
    const offset = page * capacity;
    const products = await this.deps.repository.listProductsByCategory(businessId, categoryId, capacity + 1, offset);
    const total = await this.deps.repository.countProductsByCategory(businessId, categoryId);
    if (total === 0) {
      await this.persist(session, "SUBCATEGORY_SELECTION", { ...session.payload, categoryId, categoryPath: path });
      return this.response("SUBCATEGORY_SELECTION", COPY.noProducts, {
        title: "Sin opciones",
        description: COPY.noProducts,
        replies: [
          { id: "navigation.back", label: "Volver" },
          { id: "navigation.home", label: "Menú" },
        ],
      });
    }
    const currency = (await this.deps.repository.findBusinessCurrency(businessId)) ?? "CLP";
    const hasNext = total > offset + MAX_WHATSAPP_BUTTONS;
    const visible = products.slice(0, hasNext ? MAX_WHATSAPP_BUTTONS - 1 : MAX_WHATSAPP_BUTTONS);
    const replies: Array<{ id: string; label: string }> = [];
    for (const product of visible) {
      const base = product.minQuantity ?? 1;
      const price = await this.priceFor(businessId, product.id, base, currency);
      replies.push({ id: `product:${product.id}`, label: commercialButtonLabel(product.name, price) });
    }
    replies.push(
      hasNext
        ? { id: "navigation.next", label: "Más opciones" }
        : { id: "navigation.back", label: "Volver" },
    );
    await this.persist(
      session,
      "PRODUCT_SELECTION",
      { ...session.payload, categoryId, categoryName, categoryPath: path, listing: "products" },
      { page },
    );
    return this.response("PRODUCT_SELECTION", `${categoryName}: elige tu paquete 👇`, {
      title: categoryName.slice(0, 60),
      description: "Precios finales, sin sorpresas. Puedes cambiarlo antes de pagar.",
      replies,
    });
  }

  private async openProduct(
    businessId: string,
    session: ConversationSession,
    productId: string,
  ): Promise<ConversationTurnResponse> {
    const product = await this.deps.repository.findProduct(businessId, productId);
    if (!product) {
      return this.technicalError(session, "PRODUCT_SELECTION");
    }
    const options = quantityOptionsFor(product);
    const currency = (await this.deps.repository.findBusinessCurrency(businessId)) ?? "CLP";
    const priced: Array<{ quantity: number; amount: number | null }> = [];
    for (const quantity of options.slice(0, MAX_WHATSAPP_BUTTONS - 1)) {
      priced.push({ quantity, amount: await this.priceFor(businessId, product.id, quantity, currency) });
    }
    const replies = priced.map((option) => ({
      id: `quantity:${option.quantity}`,
      label: option.amount === null
        ? String(option.quantity)
        : `${option.quantity} · ${formatCompactAmount(option.amount)}`,
    }));
    replies.push({ id: "navigation.back", label: "Volver" });
    const base = await this.priceFor(businessId, product.id, product.minQuantity ?? options[0]!, currency);
    const detail = [
      product.name,
      product.description ? `\n${product.description}` : "",
      base === null ? "" : `\nPrecio: ${formatAmount(base, currency)}`,
      product.minQuantity !== null && product.maxQuantity !== null
        ? `\nCantidades: ${product.minQuantity} a ${product.maxQuantity}`
        : "",
      "\nElige la cantidad que necesitas 👇",
    ].join("");
    await this.persist(session, "QUANTITY_SELECTION", {
      ...session.payload,
      productId: product.id,
      productName: product.name,
    });
    return this.response("QUANTITY_SELECTION", detail, {
      title: product.name.slice(0, 60),
      description: detail.slice(0, 900),
      replies,
    });
  }

  private async selectQuantity(
    businessId: string,
    session: ConversationSession,
    rawQuantity: string,
  ): Promise<ConversationTurnResponse> {
    const quantity = Number(rawQuantity);
    const product = session.payload.productId
      ? await this.deps.repository.findProduct(businessId, session.payload.productId)
      : null;
    if (!product) return this.technicalError(session, "PRODUCT_SELECTION");
    const allowed = quantityOptionsFor(product);
    // No se confía en el payload del cliente: la cantidad debe ser una opción vigente.
    if (!Number.isSafeInteger(quantity) || !allowed.includes(quantity)) {
      return this.openProduct(businessId, session, product.id);
    }
    const pendingFields = product.requiredInputs.map((field) => field.key);
    const payload: ConversationPayload = {
      ...session.payload,
      quantityOptionId: String(quantity),
      quantity,
      pendingFields,
      collectedInputs: {},
      ...(pendingFields[0] === undefined ? {} : { currentFieldKey: pendingFields[0] }),
    };
    delete payload.quoteId;
    if (pendingFields.length === 0) {
      return this.renderReview(businessId, session, payload);
    }
    await this.persist(session, "COLLECTING_REQUIRED_INPUT", payload);
    const label = product.requiredInputs[0]?.label ?? "el dato solicitado";
    return this.response("COLLECTING_REQUIRED_INPUT", label, {
      title: "Necesito un dato",
      description: label,
      expect: "text",
    });
  }

  /** Captura guiada por el backend, sin límite de campos. */
  private async collectField(
    businessId: string,
    session: ConversationSession,
    text: string,
  ): Promise<ConversationTurnResponse> {
    const payload = session.payload;
    const product = payload.productId
      ? await this.deps.repository.findProduct(businessId, payload.productId)
      : null;
    if (!product) return this.technicalError(session, "PRODUCT_SELECTION");
    const currentKey = payload.currentFieldKey;
    const field = product.requiredInputs.find((candidate) => candidate.key === currentKey);
    if (!field) return this.renderReview(businessId, session, payload);

    const value = text.trim();
    const valid = field.type === "url"
      ? isValidUrl(value)
      : field.type === "integer"
        ? isValidInteger(value)
        : field.type === "date"
          ? isValidDate(value)
          : value.length > 0;
    if (!valid) {
      await this.persist(session, "COLLECTING_REQUIRED_INPUT", payload);
      const message = field.type === "url" ? COPY.invalidUrl : COPY.invalidValue;
      return this.response("COLLECTING_REQUIRED_INPUT", message, {
        view: "REQUIRED_INPUT_ERROR",
        title: "Revisemos ese dato",
        description: message,
        expect: "text",
      });
    }

    const collected = { ...(payload.collectedInputs ?? {}), [field.key]: value };
    const pending = (payload.pendingFields ?? []).filter((key) => key !== field.key);
    const nextKey = pending[0];
    const nextPayload: ConversationPayload = {
      ...payload,
      collectedInputs: collected,
      pendingFields: pending,
      ...(nextKey === undefined ? {} : { currentFieldKey: nextKey }),
    };
    if (!nextKey) return this.renderReview(businessId, session, nextPayload);

    const nextField = product.requiredInputs.find((candidate) => candidate.key === nextKey);
    const nextLabel = nextField?.label ?? "el siguiente dato";
    await this.persist(session, "COLLECTING_REQUIRED_INPUT", nextPayload);
    return this.response("COLLECTING_REQUIRED_INPUT", nextLabel, {
      title: "Perfecto, sigamos",
      description: nextLabel,
      expect: "text",
    });
  }

  /** Resumen + confirmación. El total lo calcula el backend (quote real). */
  private async renderReview(
    businessId: string,
    session: ConversationSession,
    payload: ConversationPayload,
  ): Promise<ConversationTurnResponse> {
    let quote = payload.quoteId
      ? await this.deps.quotes.getById(businessId, payload.quoteId).catch(() => null)
      : null;
    if (!quote) {
      const currency = await this.deps.repository.findBusinessCurrency(businessId);
      if (!currency) return this.technicalError(session, "QUANTITY_SELECTION");
      try {
        quote = await this.deps.quotes.create(businessId, {
          productId: payload.productId!,
          quantity: payload.quantity!,
          currency,
          ...(session.customerId ? { customerId: session.customerId } : {}),
        });
      } catch {
        return this.technicalError(session, "QUANTITY_SELECTION");
      }
    }
    const destination = Object.values(payload.collectedInputs ?? {}).join("\n") || "—";
    const lines = [
      "Revisa tu compra:",
      `• Servicio: ${payload.productName ?? quote.productName}`,
      `• Cantidad: ${quote.quantity}`,
      `• Destino:\n${destination}`,
      `• Total: ${formatAmount(quote.totalPrice, quote.currency)}`,
    ];
    const reviewPayload: ConversationPayload = {
      ...payload,
      quoteId: quote.id,
      quoteTotal: quote.totalPrice,
      quoteCurrency: quote.currency,
    };
    await this.persist(session, "REVIEW", reviewPayload);
    return this.response("REVIEW", lines.join("\n"), {
      title: "Revisa tu compra",
      description: lines.join("\n"),
      replies: [
        { id: "checkout.confirm", label: "Confirmar compra" },
        { id: "checkout.modify", label: "Modificar" },
        { id: "checkout.cancel", label: "Cancelar" },
      ],
    });
  }

  private async handleCheckout(
    businessId: string,
    session: ConversationSession,
    buttonId: string,
  ): Promise<ConversationTurnResponse> {
    const payload = session.payload;
    if (buttonId === "checkout.cancel") {
      await this.persist(session, "MAIN_MENU", {});
      return this.response("MAIN_MENU", COPY.cancelled, {
        title: "Compra cancelada",
        description: COPY.cancelled,
        replies: [
          { id: "menu.buy", label: "Comprar servicios" },
          { id: "navigation.home", label: "Menú" },
        ],
      });
    }
    if (buttonId === "checkout.modify") {
      return this.response("QUANTITY_SELECTION", "¿Qué quieres ajustar?", {
        title: "Modificar compra",
        description: "Elige qué quieres cambiar.",
        replies: [
          { id: "navigation.back", label: "Cambiar servicio" },
          { id: `product:${payload.productId ?? ""}`, label: "Cambiar cantidad" },
          { id: "payment.confirm_transfer", label: "Cambiar datos" },
        ],
      });
    }
    // checkout.confirm: la idempotencia la garantiza la conversión única de quote.
    if (!payload.quoteId) return this.renderMainMenu(businessId, session);
    let order = payload.orderId
      ? await this.deps.orders.getById(businessId, payload.orderId).catch(() => null)
      : null;
    if (!order) {
      try {
        order = await this.deps.orders.create(businessId, {
          quoteId: payload.quoteId,
          ...(session.customerId ? { customerId: session.customerId } : {}),
          ...(Object.keys(payload.collectedInputs ?? {}).length > 0
            ? { fulfillmentInput: payload.collectedInputs as Record<string, string> }
            : {}),
        });
      } catch {
        return this.technicalError(session, "REVIEW");
      }
    }
    return this.renderPaymentMethods(businessId, session, { ...payload, orderId: order.id });
  }

  private async renderPaymentMethods(
    businessId: string,
    session: ConversationSession,
    payload: ConversationPayload,
  ): Promise<ConversationTurnResponse> {
    let methods;
    try {
      methods = await this.deps.paymentMethods.list(businessId, "active");
    } catch {
      return this.technicalError(session, "PAYMENT_METHOD_SELECTION");
    }
    if (methods.length === 0) {
      return this.technicalError(session, "PAYMENT_METHOD_SELECTION");
    }
    const replies = methods
      .slice(0, MAX_WHATSAPP_BUTTONS - 1)
      .map((method) => ({ id: `payment:${method.id}`, label: method.name }));
    replies.push({ id: "navigation.home", label: "Menú" });
    await this.persist(session, "PAYMENT_METHOD_SELECTION", payload);
    return this.response("PAYMENT_METHOD_SELECTION", "¿Cómo prefieres pagar?", {
      title: "Forma de pago",
      description: "Elige cómo quieres pagar tu pedido.",
      replies,
    });
  }

  private async selectPaymentMethod(
    businessId: string,
    session: ConversationSession,
    paymentMethodId: string,
  ): Promise<ConversationTurnResponse> {
    const payload = session.payload;
    if (!payload.orderId) return this.renderMainMenu(businessId, session);
    let methods;
    try {
      methods = await this.deps.paymentMethods.list(businessId, "active");
    } catch {
      return this.technicalError(session, "PAYMENT_METHOD_SELECTION");
    }
    const method = methods.find((candidate) => candidate.id === paymentMethodId);
    // El método debe existir y estar activo en el negocio de la credencial.
    if (!method) return this.renderPaymentMethods(businessId, session, payload);

    const existing = payload.paymentId
      ? await this.deps.payments.getById(businessId, payload.paymentId).catch(() => null)
      : null;
    let payment = existing;
    if (!payment) {
      try {
        const outcome = await this.deps.payments.create(
          businessId,
          payload.orderId,
          { paymentMethodId: method.id },
          `${payload.orderId}:${method.id}`,
        );
        payment = outcome.payment;
      } catch {
        return this.technicalError(session, "PAYMENT_METHOD_SELECTION");
      }
    }

    if (method.type === "bank_transfer") {
      const config = method.config as Record<string, unknown>;
      const row = (label: string, value: unknown) =>
        value === undefined || value === null || String(value).length === 0 ? "" : `${label}: ${String(value)}`;
      const detail = [
        "Datos para transferir:",
        row("Banco", config.bankName),
        row("Tipo de cuenta", config.accountType),
        row("Número", config.accountNumber),
        row("Titular", config.accountHolder),
        row("RUT", config.rut),
        row("Correo", config.email),
        `Monto exacto: ${formatAmount(payment.amount ?? payload.quoteTotal ?? null, payload.quoteCurrency ?? "CLP")}`,
      ].filter((line) => line.length > 0);
      const nextPayload: ConversationPayload = { ...payload, paymentId: payment.id };
      await this.persist(session, "PAYMENT_PENDING", nextPayload);
      return this.response("PAYMENT_PENDING", detail.join("\n"), {
        view: "BANK_TRANSFER",
        title: "Transferencia bancaria",
        description: detail.join("\n"),
        replies: [
          { id: "payment.confirm_transfer", label: "Ya transferí" },
          { id: `payment:${method.id}`, label: "Cambiar método" },
          { id: "navigation.home", label: "Menú" },
        ],
      });
    }

    const nextPayload: ConversationPayload = {
      ...payload,
      paymentId: payment.id,
      ...(payment.checkoutUrl ? { checkoutUrl: payment.checkoutUrl } : {}),
    };
    await this.persist(session, "PAYMENT_PENDING", nextPayload);
    const amount = formatAmount(payment.amount ?? payload.quoteTotal ?? null, payload.quoteCurrency ?? "CLP");
    const message = `Tu pedido está listo para pagar ✅\n\nTotal: ${amount}\n\nPuedes pagar de forma segura con Mercado Pago.`;
    if (payment.checkoutUrl) {
      return this.response("PAYMENT_PENDING", message, {
        view: "MERCADO_PAGO",
        title: "Pago con Mercado Pago",
        description: message,
        replies: [{ id: "order.refresh", label: "Ya pagué" }, { id: "navigation.home", label: "Menú" }],
        urlButtons: [{ url: payment.checkoutUrl, label: "Pagar ahora" }],
      });
    }
    return this.response("PAYMENT_PENDING", message, {
      title: "Pago con Mercado Pago",
      description: message,
      replies: [{ id: "order.refresh", label: "Ya pagué" }, { id: "navigation.home", label: "Menú" }],
    });
  }

  private async confirmTransfer(
    businessId: string,
    session: ConversationSession,
  ): Promise<ConversationTurnResponse> {
    const text = "Gracias 🙌 Cuando el equipo confirme tu transferencia, tu pedido se prepara automáticamente. Si quieres, puedes enviarnos el comprobante por este mismo chat.";
    await this.persist(session, "PAYMENT_PENDING", session.payload);
    return this.response("PAYMENT_PENDING", text, {
      title: "Transferencia registrada",
      description: text,
      replies: [{ id: "order.refresh", label: "Ver estado" }, { id: "navigation.home", label: "Menú" }],
      expect: "media",
    });
  }

  private async handleMedia(
    businessId: string,
    session: ConversationSession,
    media: string,
  ): Promise<ConversationTurnResponse> {
    const text = "Recibimos tu archivo 🙌 El equipo lo revisará y te confirmamos por aquí.";
    await this.persist(session, "PAYMENT_PENDING", session.payload);
    return this.response("PAYMENT_PENDING", text, {
      view: "RECEIPT",
      title: "Comprobante recibido",
      description: `${text}\n\n${media.slice(0, 120)}`,
      replies: [{ id: "order.refresh", label: "Ver estado" }, { id: "navigation.home", label: "Menú" }],
    });
  }

  private async openOrders(
    businessId: string,
    session: ConversationSession,
    page: number,
  ): Promise<ConversationTurnResponse> {
    if (!session.customerId) {
      return this.response("ORDER_STATUS", COPY.noOrders, {
        title: "Sin pedidos",
        description: COPY.noOrders,
        replies: [{ id: "menu.buy", label: "Comprar servicios" }, { id: "navigation.home", label: "Menú" }],
      });
    }
    const capacity = pageCapacity({ navigationSlots: 1 });
    const orders = await this.deps.repository.listOrdersByCustomer(
      businessId,
      session.customerId,
      capacity + 1,
      page * capacity,
    );
    const total = await this.deps.repository.countOrdersByCustomer(businessId, session.customerId);
    if (total === 0) {
      await this.persist(session, "ORDER_STATUS", { ...session.payload, listing: "orders" }, { page });
      return this.response("ORDER_STATUS", COPY.noOrders, {
        title: "Sin pedidos",
        description: COPY.noOrders,
        replies: [{ id: "menu.buy", label: "Comprar servicios" }, { id: "navigation.home", label: "Menú" }],
      });
    }
    const visible = orders.slice(0, capacity);
    const hasNext = total > page * capacity + visible.length;
    const replies = visible.map((order) => ({
      id: `order:${order.id}`,
      label: `Pedido ${order.id.slice(0, 6)}`,
    }));
    replies.push(hasNext ? { id: "navigation.next", label: "Más opciones" } : { id: "navigation.home", label: "Menú" });
    await this.persist(session, "ORDER_STATUS", { ...session.payload, listing: "orders" }, { page });
    return this.response("ORDER_STATUS", "Tus pedidos 👇", {
      title: "Mis pedidos",
      description: "Elige el pedido que quieres revisar.",
      replies,
    });
  }

  private async showOrder(
    businessId: string,
    session: ConversationSession,
    orderId: string,
  ): Promise<ConversationTurnResponse> {
    if (!orderId) return this.openOrders(businessId, session, 0);
    const order = await this.deps.orders.getById(businessId, orderId).catch(() => null);
    if (!order) {
      return this.response("ORDER_STATUS", COPY.noOrders, {
        title: "Sin pedidos",
        description: COPY.noOrders,
        replies: [{ id: "menu.orders", label: "Mis pedidos" }, { id: "navigation.home", label: "Menú" }],
      });
    }
    const label = STATUS_LABELS[order.status] ?? order.status;
    const detail = [
      `Pedido ${order.id.slice(0, 8)}`,
      `Estado: ${label}`,
      `Total: ${formatAmount(order.total, order.currency)}`,
    ].join("\n");
    await this.persist(session, "ORDER_STATUS", { ...session.payload, orderId: order.id });
    return this.response("ORDER_STATUS", detail, {
      title: "Estado de tu pedido",
      description: detail,
      replies: [
        { id: "order.refresh", label: "Actualizar" },
        { id: "help.human", label: "Ayuda" },
        { id: "navigation.home", label: "Menú" },
      ],
    });
  }

  /** Re-presenta la etapa actual sin avanzar: soporte del botón Reintentar. */
  private async renderCurrentView(
    businessId: string,
    session: ConversationSession,
  ): Promise<ConversationTurnResponse> {
    const payload = session.payload;
    switch (session.state) {
      case "CATEGORY_SELECTION":
        return this.openParentCategories(businessId, session, session.page);
      case "SUBCATEGORY_SELECTION":
        return payload.categoryId
          ? this.renderChildCategories(
              businessId, session, payload.categoryId, payload.categoryName ?? "",
              payload.categoryPath ?? [], session.page,
            )
          : this.openParentCategories(businessId, session, 0);
      case "PRODUCT_SELECTION":
        return payload.categoryId
          ? this.renderProducts(
              businessId, session, payload.categoryId, payload.categoryName ?? "",
              payload.categoryPath ?? [], session.page,
            )
          : this.openParentCategories(businessId, session, 0);
      case "QUANTITY_SELECTION":
        return payload.productId
          ? this.openProduct(businessId, session, payload.productId)
          : this.openParentCategories(businessId, session, 0);
      case "COLLECTING_REQUIRED_INPUT": {
        const product = payload.productId
          ? await this.deps.repository.findProduct(businessId, payload.productId)
          : null;
        const field = product?.requiredInputs.find((candidate) => candidate.key === payload.currentFieldKey);
        return this.response("COLLECTING_REQUIRED_INPUT", field?.label ?? "Envíame el dato solicitado", {
          title: "Necesito un dato",
          description: field?.label ?? "Envíame el dato solicitado",
          expect: "text",
        });
      }
      case "REVIEW":
        return this.renderReview(businessId, session, payload);
      case "PAYMENT_METHOD_SELECTION":
        return this.renderPaymentMethods(businessId, session, payload);
      case "PAYMENT_PENDING":
        return payload.paymentId && payload.orderId
          ? this.renderPaymentMethods(businessId, session, payload)
          : this.renderMainMenu(businessId, session);
      case "ORDER_STATUS":
        return this.openOrders(businessId, session, session.page);
      case "FAQ":
        return this.response("FAQ", COPY.faq, { view: "FAQ", expect: "text" });
      case "SUPPORT":
        return this.renderHelpMenu(businessId, session);
      case "HUMAN_HANDOFF":
        return this.response("HUMAN_HANDOFF", COPY.handoff, {
          view: "HUMAN_HANDOFF",
          title: "Atención humana",
          description: COPY.handoff,
          replies: [{ id: "menu.buy", label: "Comprar servicios" }, { id: "navigation.home", label: "Menú" }],
        });
      default:
        return this.renderMainMenu(businessId, session);
    }
  }

  private async goBack(
    businessId: string,
    session: ConversationSession,
  ): Promise<ConversationTurnResponse> {
    const path = [...(session.payload.categoryPath ?? [])];
    if (session.state === "PRODUCT_SELECTION" || session.state === "QUANTITY_SELECTION") {
      const categoryId = path[path.length - 1] ?? session.payload.categoryId;
      if (!categoryId) return this.openParentCategories(businessId, session, 0);
      const category = await this.deps.repository.findCategory(businessId, categoryId);
      if (!category) return this.openParentCategories(businessId, session, 0);
      const parentPath = path.slice(0, -1);
      const childCount = await this.deps.repository.countChildCategories(businessId, category.id);
      return childCount > 0
        ? this.renderChildCategories(businessId, session, category.id, category.name, [...parentPath, category.id], 0)
        : this.renderProducts(businessId, session, category.id, category.name, path, 0);
    }
    if (path.length > 1) {
      const current = path[path.length - 1]!;
      const parent = await this.deps.repository.findCategory(businessId, path[path.length - 2]!);
      if (parent) {
        return this.renderChildCategories(
          businessId,
          session,
          parent.id,
          parent.name,
          path.slice(0, -1),
          0,
        );
      }
      const fallback = await this.deps.repository.findCategory(businessId, current);
      if (fallback) return this.openParentCategories(businessId, session, 0);
    }
    return this.openParentCategories(businessId, session, 0);
  }

  private async nextPage(
    businessId: string,
    session: ConversationSession,
  ): Promise<ConversationTurnResponse> {
    const page = session.page + 1;
    switch (session.payload.listing) {
      case "products":
        return this.renderProducts(
          businessId,
          session,
          session.payload.categoryId ?? "",
          session.payload.categoryName ?? "",
          session.payload.categoryPath ?? [],
          page,
        );
      case "orders":
        return this.openOrders(businessId, session, page);
      default:
        if (session.payload.categoryId) {
          return this.renderChildCategories(
            businessId,
            session,
            session.payload.categoryId,
            session.payload.categoryName ?? "",
            session.payload.categoryPath ?? [],
            page,
          );
        }
        return this.openParentCategories(businessId, session, page);
    }
  }

  /**
   * Texto libre conversacional: solo aquí (y en FAQ/soporte) interviene la IA.
   * Nunca decide categoría, producto, cantidad ni pago.
   */
  private async conversationalReply(
    businessId: string,
    session: ConversationSession,
    text: string,
  ): Promise<ConversationTurnResponse> {
    const fallback: string = session.state === "WELCOME" ? COPY.welcomeFallback : COPY.needButtons;
    let message: string = fallback;
    let usedAi = false;
    if (this.deps.ai && text.length > 0) {
      try {
        const answer = await this.deps.ai.reply({
          businessId,
          message: text,
          customerId: session.customerId,
          conversationId: session.id,
          context: { state: session.state, productName: session.payload.productName },
        });
        if (answer && answer.message.trim().length > 0) {
          message = answer.message.trim();
          usedAi = true;
        }
      } catch {
        message = fallback;
      }
    }
    const state: ConversationState = session.state === "FAQ" ? "FAQ" : "MAIN_MENU";
    await this.persist(session, state, session.payload);
    return this.response(state, message, {
      title: session.state === "FAQ" ? "Preguntas frecuentes" : "Estoy para ayudarte",
      description: message,
      replies: [
        { id: "menu.buy", label: "Comprar servicios" },
        { id: state === "FAQ" ? "help.faq" : "help.human", label: state === "FAQ" ? "Otra pregunta" : "Hablar con alguien" },
        { id: "navigation.home", label: "Menú" },
      ],
      aiComposed: usedAi,
    });
  }

  private async technicalError(
    session: ConversationSession,
    state: ConversationState,
  ): Promise<ConversationTurnResponse> {
    await this.persist(session, state, session.payload);
    return this.response(state, COPY.technical, {
      view: "ERROR",
      title: "Un momento",
      description: COPY.technical,
      replies: [
        { id: "navigation.home", label: "Reintentar" },
        { id: "menu.help", label: "Ayuda" },
        { id: "help.human", label: "Hablar con alguien" },
      ],
    });
  }
}
