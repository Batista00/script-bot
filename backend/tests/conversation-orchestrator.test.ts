import assert from "node:assert/strict";
import { test } from "node:test";

import { ConversationService } from "../src/modules/conversation/conversation.service.js";
import { renderWhatsAppButtons, MAX_WHATSAPP_BUTTONS } from "../src/modules/conversation/conversation.buttons.js";
import type {
  CategoryNode,
  ConversationPayload,
  ConversationSession,
  ConversationState,
  ConversationTurnResponse,
  OrderSummary,
  ProductNode,
} from "../src/modules/conversation/conversation.types.js";

const businessA = "1b6d119f-b7c9-4f6e-b203-35798da9f32b";
const customerA = "f3193784-f634-4d89-adb8-8e97dac7095e";
const remoteA = "56900000001@s.whatsapp.net";
const url = (n: number) => `https://instagram.com/p/${n}`;

const categories: CategoryNode[] = [
  { id: "c-instagram", name: "Instagram", parentId: null },
  { id: "c-tiktok", name: "TikTok", parentId: null },
  { id: "c-spotify", name: "Spotify", parentId: null },
  { id: "c-facebook", name: "Facebook", parentId: null },
  { id: "c-likes", name: "Likes", parentId: "c-instagram" },
  { id: "c-views", name: "Visualizaciones", parentId: "c-likes" },
];

const products: Record<string, ProductNode> = {
  "p-1": {
    id: "p-1", name: "1.000 Likes", description: "Entrega inmediata",
    minQuantity: 1000, maxQuantity: 1000,
    requiredInputs: [{ key: "targetUrl", label: "Envíame el enlace de la publicación", type: "url", required: true, validation: {} }],
  },
  "p-3": {
    id: "p-3", name: "Pack 3 enlaces", description: "Tres publicaciones",
    minQuantity: 100, maxQuantity: 1000,
    requiredInputs: [
      { key: "url1", label: "Envíame el primer enlace", type: "url", required: true, validation: {} },
      { key: "url2", label: "Ahora envíame el segundo enlace", type: "url", required: true, validation: {} },
      { key: "url3", label: "Por último, el tercer enlace", type: "url", required: true, validation: {} },
    ],
  },
};

class MemoryConversationRepository {
  session: ConversationSession | null = null;
  turns = new Map<string, ConversationTurnResponse>();
  orders: OrderSummary[] = [];
  categoryProducts: Record<string, ProductNode[]> = { "c-views": [products["p-1"]!, products["p-3"]!] };

  async findSession(businessId: string, remoteJid: string) {
    return this.session && this.session.businessId === businessId && this.session.remoteJid === remoteJid
      ? structuredClone(this.session) : null;
  }
  async saveSession(session: {
    businessId: string; remoteJid: string; customerId: string | null; state: ConversationState;
    payload: ConversationPayload; page: number; handoff: boolean;
  }) {
    this.session = { id: "session-1", ...structuredClone(session) };
    return structuredClone(this.session);
  }
  async findTurn(businessId: string, dedupeKey: string) {
    return this.turns.get(`${businessId}:${dedupeKey}`) ?? null;
  }
  async saveTurn(businessId: string, _remoteJid: string, dedupeKey: string, response: ConversationTurnResponse) {
    this.turns.set(`${businessId}:${dedupeKey}`, structuredClone(response));
  }
  async listParentCategories(_b: string, limit: number, offset: number) {
    return categories.filter((c) => c.parentId === null).slice(offset, offset + limit);
  }
  async countParentCategories() { return categories.filter((c) => c.parentId === null).length; }
  async listChildCategories(_b: string, parentId: string, limit: number, offset: number) {
    return categories.filter((c) => c.parentId === parentId).slice(offset, offset + limit);
  }
  async countChildCategories(_b: string, parentId: string) {
    return categories.filter((c) => c.parentId === parentId).length;
  }
  async findCategory(_b: string, id: string) { return categories.find((c) => c.id === id) ?? null; }
  async listProductsByCategory(_b: string, categoryId: string, limit: number, offset: number) {
    return (this.categoryProducts[categoryId] ?? []).slice(offset, offset + limit);
  }
  async countProductsByCategory(_b: string, categoryId: string) {
    return (this.categoryProducts[categoryId] ?? []).length;
  }
  async findProduct(_b: string, id: string) { return products[id] ?? null; }
  async listOrdersByCustomer(_b: string, _c: string, limit: number, offset: number) {
    return this.orders.slice(offset, offset + limit);
  }
  async countOrdersByCustomer() { return this.orders.length; }
  async findBusinessCurrency() { return "CLP"; }
}

interface Calls { quotes: number; orders: number; payments: number; ai: number }

function setup(calls: Calls = { quotes: 0, orders: 0, payments: 0, ai: 0 }) {
  const repository = new MemoryConversationRepository();
  repository.orders = [{ id: "order-1", status: "pending_payment", total: 4990, currency: "CLP", createdAt: new Date().toISOString() }];
  let orderCreated = false;
  let paymentCreated = false;
  const service = new ConversationService({
    repository: repository as never,
    customers: { resolve: async () => ({ id: customerA, name: "Carlos" }) } as never,
    quotes: {
      create: async () => {
        calls.quotes += 1;
        return { id: "quote-1", productName: "1.000 Likes", quantity: 1000, totalPrice: 4990, currency: "CLP", status: "active" };
      },
      getById: async () => ({ id: "quote-1", productName: "1.000 Likes", quantity: 1000, totalPrice: 4990, currency: "CLP", status: "active" }),
    } as never,
    orders: {
      create: async () => {
        calls.orders += 1;
        if (orderCreated) throw new Error("already converted");
        orderCreated = true;
        return { id: "order-created-1", status: "pending_payment", total: 4990, currency: "CLP" };
      },
      getById: async () => ({ id: "order-created-1", status: "paid", total: 4990, currency: "CLP" }),
    } as never,
    payments: {
      create: async () => {
        calls.payments += 1;
        if (paymentCreated) throw new Error("duplicated");
        paymentCreated = true;
        return { payment: { id: "payment-1", amount: 4990, checkoutUrl: "https://mercadopago.cl/checkout/v1/redirect?pref_id=abc" }, created: true };
      },
      getById: async () => ({ id: "payment-1", amount: 4990, checkoutUrl: "https://mercadopago.cl/checkout/v1/redirect?pref_id=abc" }),
    } as never,
    paymentMethods: {
      list: async () => ([
        { id: "pm-mp", type: "mercado_pago", name: "Mercado Pago", config: {} },
        { id: "pm-bank", type: "bank_transfer", name: "Transferencia", config: { bankName: "Banco Estado", rut: "1-9", accountNumber: "123", accountHolder: "Flowchat", accountType: "Cuenta corriente", email: "pagos@flowchat.cl" } },
      ]),
    } as never,
    ai: {
      reply: async () => { calls.ai += 1; return { message: "¡Hola! 👋 ¿En qué te ayudo hoy?", action: "reply" }; },
    },
  });
  return { service, repository, calls };
}

const turn = (service: ConversationService, body: Record<string, unknown>) =>
  service.handleTurn(businessA, { remoteJid: remoteA, ...body } as never);

test("bienvenida por IA y menú principal con botones nativos", async () => {
  const calls = { quotes: 0, orders: 0, payments: 0, ai: 0 };
  const { service } = setup(calls);
  const response = await turn(service, { messageId: "m-welcome", text: "Hola" });
  assert.equal(response.state, "MAIN_MENU");
  assert.match(response.message, /Hola/);
  assert.match(response.renderedMessage, /\[buttons\]/);
  assert.match(response.renderedMessage, /id: menu\.buy/);
  assert.equal(response.expect, "button");
  assert.equal(calls.ai, 1, "la IA participa en la bienvenida");
});

test("menu.buy devuelve solo categorías padre y pagina con botones", async () => {
  const { service } = setup();
  const response = await turn(service, { messageId: "m-buy", buttonId: "menu.buy" });
  assert.equal(response.state, "CATEGORY_SELECTION");
  const ids = [...response.renderedMessage.matchAll(/id: (category:[a-z-]+)/g)].map((m) => m[1]);
  assert.ok(ids.includes("category:c-instagram"));
  assert.equal(ids.length, 2, "capacidad de página respetada (3 botones - 1 navegación)");
  assert.match(response.renderedMessage, /id: navigation\.next/, "hay más categorías que botones: se pagina");
  assert.doesNotMatch(response.renderedMessage, /product:/, "nunca productos en el nivel padre");
  assert.equal(response.renderedMessage.includes("[list]"), false, "sin mensajes de lista");
  const replyIds = [...response.renderedMessage.matchAll(/id: (\S+)/g)].map((m) => m[1]);
  assert.ok(replyIds.length <= MAX_WHATSAPP_BUTTONS, "nunca se excede el máximo real de botones");
});

test("categoría con hijos desciende y categoría hoja muestra productos", async () => {
  const { service } = setup();
  const children = await turn(service, { messageId: "m-cat", buttonId: "category:c-instagram" });
  assert.equal(children.state, "SUBCATEGORY_SELECTION");
  assert.match(children.renderedMessage, /id: category:c-likes/);
  assert.doesNotMatch(children.renderedMessage, /product:/);

  const grandchild = await turn(service, { messageId: "m-likes", buttonId: "category:c-likes" });
  assert.match(grandchild.renderedMessage, /id: category:c-views/, "multinivel sin límite de profundidad");

  const leaf = await turn(service, { messageId: "m-views", buttonId: "category:c-views" });
  assert.equal(leaf.state, "PRODUCT_SELECTION");
  assert.match(leaf.renderedMessage, /id: product:p-1/);
  assert.match(leaf.renderedMessage, /id: product:p-3/);
});

test("producto valida negocio/estado y ofrece cantidades por botón", async () => {
  const { service } = setup();
  const response = await turn(service, { messageId: "m-prod", buttonId: "product:p-1" });
  assert.equal(response.state, "QUANTITY_SELECTION");
  assert.match(response.renderedMessage, /id: quantity:1000/);
  const unknown = await turn(service, { messageId: "m-prod-x", buttonId: "product:no-existe" });
  assert.doesNotMatch(unknown.renderedMessage, /id: quantity:/, "producto ajeno no habilita cantidades");
});

test("cantidad fuera de las opciones del backend no se acepta", async () => {
  const { service } = setup();
  await turn(service, { messageId: "m-p", buttonId: "product:p-1" });
  const invalid = await turn(service, { messageId: "m-q-bad", buttonId: "quantity:999999" });
  assert.match(invalid.renderedMessage, /id: quantity:1000/, "vuelve a ofrecer las opciones válidas");
});

test("required inputs: se piden secuencialmente sin límite de 3 y el backend valida", async () => {
  const calls = { quotes: 0, orders: 0, payments: 0, ai: 0 };
  const { service } = setup(calls);
  await turn(service, { messageId: "m-p3", buttonId: "product:p-3" });
  const first = await turn(service, { messageId: "m-q3", buttonId: "quantity:100" });
  assert.equal(first.state, "COLLECTING_REQUIRED_INPUT");
  assert.match(first.message, /primer enlace/);
  assert.equal(first.expect, "text");

  const bad = await turn(service, { messageId: "m-bad", text: "no-es-una-url" });
  assert.match(bad.message, /no parece válido/);
  assert.equal(bad.state, "COLLECTING_REQUIRED_INPUT");
  assert.equal(calls.ai, 0, "texto de captura nunca va a la IA");

  const second = await turn(service, { messageId: "m-u1", text: url(1) });
  assert.match(second.message, /segundo/);
  const third = await turn(service, { messageId: "m-u2", text: url(2) });
  assert.match(third.message, /tercer/);
  const review = await turn(service, { messageId: "m-u3", text: url(3) });
  assert.equal(review.state, "REVIEW");
  assert.match(review.renderedMessage, /id: checkout\.confirm/);
  assert.equal(calls.quotes, 1);
  const order = await turn(service, { messageId: "m-u3", text: url(3) });
  assert.deepEqual(order, review, "mismo messageId: no se repite la operación");
  assert.equal(calls.quotes, 1);
});

test("confirmación crea un solo order y ofrece pagos con botones", async () => {
  const calls = { quotes: 0, orders: 0, payments: 0, ai: 0 };
  const { service } = setup(calls);
  await turn(service, { messageId: "c1", buttonId: "product:p-1" });
  await turn(service, { messageId: "c2", buttonId: "quantity:1000" });
  await turn(service, { messageId: "c3", text: url(9) });
  const payments = await turn(service, { messageId: "c4", buttonId: "checkout.confirm" });
  assert.equal(payments.state, "PAYMENT_METHOD_SELECTION");
  assert.match(payments.renderedMessage, /id: payment:pm-mp/);
  assert.match(payments.renderedMessage, /id: payment:pm-bank/);
  assert.equal(calls.orders, 1);

  const mercadoPago = await turn(service, { messageId: "c5", buttonId: "payment:pm-mp" });
  assert.equal(mercadoPago.state, "PAYMENT_PENDING");
  assert.match(mercadoPago.renderedMessage, /\[url\]/);
  assert.match(mercadoPago.renderedMessage, /url: https:\/\/mercadopago\.cl/);
  assert.equal(calls.payments, 1);

  const bank = await turn(service, { messageId: "c6", buttonId: "payment:pm-bank" });
  assert.match(bank.message, /Banco Estado/);
  assert.match(bank.message, /Monto exacto/);
  assert.match(bank.renderedMessage, /id: payment\.confirm_transfer/);
});

test("estado del pedido y handoff usan datos reales y no inventan estados", async () => {
  const { service } = setup();
  const orders = await turn(service, { messageId: "o1", buttonId: "menu.orders" });
  assert.equal(orders.state, "ORDER_STATUS");
  assert.match(orders.renderedMessage, /id: order:order-1/);

  const detail = await turn(service, { messageId: "o2", buttonId: "order:order-1" });
  assert.match(detail.message, /Pagado|Pago confirmado/);
  assert.match(detail.renderedMessage, /id: order\.refresh/);

  const handoff = await turn(service, { messageId: "h1", buttonId: "help.human" });
  assert.equal(handoff.state, "HUMAN_HANDOFF");
  assert.equal(handoff.expect, "button");
});

test("FAQ conversa con IA y no inicia una venta", async () => {
  const calls = { quotes: 0, orders: 0, payments: 0, ai: 0 };
  const { service } = setup(calls);
  await turn(service, { messageId: "f1", buttonId: "help.faq" });
  const answer = await turn(service, { messageId: "f2", text: "¿Los seguidores se mantienen?" });
  assert.equal(calls.ai, 1);
  assert.equal(answer.state, "FAQ");
  assert.equal(calls.quotes + calls.orders, 0, "la IA no ejecuta operaciones comerciales");
  assert.match(answer.renderedMessage, /id: menu\.buy/);
});

test("renderer de botones: formato Evolution, límite real y sin ids inseguros", () => {
  const markup = renderWhatsAppButtons({
    title: "Selecciona una categoría",
    description: "Elige la opción que quieres revisar.",
    replies: [
      { id: "category:abc", label: "Instagram" },
      { id: "navigation.home", label: "Menú" },
    ],
  });
  assert.match(markup, /^\[buttons\]/);
  assert.match(markup, /\[title\]Selecciona una categoría/);
  assert.match(markup, /\[description\]/);
  assert.match(markup, /\[reply\]\ndisplayText: Instagram\nid: category:abc/);
  assert.equal(markup.includes("[list]"), false);

  assert.throws(() => renderWhatsAppButtons({
    title: "x", description: "y",
    replies: [
      { id: "a", label: "1" }, { id: "b", label: "2" },
      { id: "c", label: "3" }, { id: "d", label: "4" },
    ],
  }), /too many buttons/);

  assert.throws(() => renderWhatsAppButtons({
    title: "x", description: "y",
    replies: [{ id: "id con espacios", label: "Malo" }],
  }), /invalid characters/);
});
