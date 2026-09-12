#!/usr/bin/env node
/**
 * Validador del flujo productivo delgado.
 *
 * Regla de arquitectura: Typebot presenta y transporta; el backend decide.
 * Este validador falla si el flujo recupera lógica comercial.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FLOW = resolve(here, "bot-whatsap-thin-v1.json");

const ALLOWED_BLOCKS = new Set(["text", "text input", "choice input", "Webhook", "Condition", "openai"]);
const AI_BLOCK_ID = "blksalesai";
const AI_VARIABLE = "vaimessage";
const TEXT_SOURCE_VARIABLE = "vtextsource";
/**
 * Variables sobre las que el flujo puede ramificar. Las dos las decide el
 * backend: `vview` es la experiencia a presentar y `vtextsource` dice si el
 * propio backend ya redactó el texto con IA (para no duplicar la voz).
 */
const ROUTABLE_VARIABLES = new Set(["vview", TEXT_SOURCE_VARIABLE]);
const FORBIDDEN = [
  [/product\d/i, "product arrays (product1, product2...)"],
  [/paymentMethod\d/i, "payment arrays (paymentMethod1...)"],
  [/selectedInput\d/i, "fixed requiredInput slots"],
  [/fulfillmentInput/i, "fulfillmentInput built in Typebot"],
  [/quantityValid/i, "local quantity validation"],
  [/JSON\.stringify|JSON\.parse/, "JSON handling in Typebot"],
  [/function\s*\(|=>\s*\{|var\s|let\s|const\s/, "JavaScript statements"],
  [/providerServiceId|externalServiceId|providerKey/i, "provider identifiers"],
  [/bw_[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9]{10,}/, "secrets"],
  [/\bunitPrice\b|\btotalPrice\b|\bprice\b\s*[:=]/, "price handling"],
  [/instagram|tiktok|facebook|youtube/i, "hardcoded categories"],
  [/\[list\]/, "interactive list messages"],
];

function fail(message) {
  throw new Error(`Thin Typebot invalid: ${message}`);
}

export function validateThinTypebot(flow) {
  if (flow.version !== "6.1") fail("version must be 6.1");
  for (const key of ["events", "groups", "edges", "variables"]) {
    if (!Array.isArray(flow[key])) fail(`${key} must be an array`);
  }
  const blocks = flow.groups.flatMap((group) => group.blocks ?? []);
  for (const block of blocks) {
    if (!ALLOWED_BLOCKS.has(block.type)) {
      fail(`block ${block.id} uses ${block.type}; the thin flow only presents and transports`);
    }
  }
  const serialized = JSON.stringify(flow);
  for (const [pattern, description] of FORBIDDEN) {
    if (pattern.test(serialized)) fail(`contains ${description}`);
  }
  // Debe existir exactamente un punto de entrada conversacional.
  const endpoints = blocks
    .filter((block) => block.type === "Webhook")
    .map((block) => block.options?.webhook?.url ?? "");
  // Una llamada por turno: el bucle alterna dos grupos, cada uno con su propio
  // webhook, porque una pasada debe terminar siempre en una entrada pendiente
  // (si termina en un bloque ya respondido, Typebot cierra la sesión).
  const conversation = endpoints.filter((url) => url.includes("/bot/v1/conversation/turn"));
  if (conversation.length < 1 || conversation.length > 2) {
    fail(`the flow must call /bot/v1/conversation/turn once per turn (found ${conversation.length})`);
  }
  if (endpoints.some((url) => url.includes("n8n"))) fail("n8n must not appear in the flow");
  // El mensaje mostrado es la respuesta del backend, sin transformarla.
  const renders = blocks.filter((block) => block.type === "text").map((block) =>
    (block.content?.richText ?? []).flatMap((node) => (node.children ?? []).map((child) => child.text ?? "")).join(""));
  if (!renders.some((text) => text.includes("{{renderedMessage}}"))) {
    fail("the flow must display the backend renderedMessage");
  }
  // La voz comercial vive en un único bloque OpenAI del arranque: presenta y
  // acompaña, nunca decide (sin funciones) y siempre lee el mensaje del backend.
  const aiBlocks = blocks.filter((block) => block.type === "openai");
  if (aiBlocks.length !== 1) {
    fail(`expected exactly one OpenAI sales voice, found ${aiBlocks.length}`);
  }
  const bootstrapIds = new Set((flow.groups.find((group) => group.id === "grp00")?.blocks ?? []).map((block) => block.id));
  for (const block of aiBlocks) {
    if (block.id !== AI_BLOCK_ID || !bootstrapIds.has(block.id)) {
      fail(`the OpenAI sales voice must be ${AI_BLOCK_ID} in the bootstrap group`);
    }
    const options = block.options ?? {};
    if ((options.functions ?? []).length > 0) {
      fail("the OpenAI sales voice must not run business functions");
    }
    const mapping = (options.responseMapping ?? []).map((entry) => entry.variableId);
    if (!mapping.includes(AI_VARIABLE)) fail(`the OpenAI sales voice must map its answer to ${AI_VARIABLE}`);
    const instructions = String(options.instructions ?? "");
    const message = String(options.message ?? "");
    if (instructions.trim().length === 0) fail("the OpenAI sales voice needs explicit instructions");
    if (!/nunca inventes/i.test(instructions)) fail("the OpenAI sales voice must forbid inventing offers");
    if (!/no confirmes|nunca confirmes/i.test(instructions)) fail("the OpenAI sales voice must not confirm payments");
    if (!message.includes("{{renderedMessage}}")) fail("the OpenAI sales voice must read the backend renderedMessage");
    if (!message.includes("{{turn}}")) fail("the OpenAI sales voice must read the customer message");
  }
  if (!renders.some((text) => text.includes("{{aiMessage}}"))) {
    fail("the flow must present the sales voice before the backend message");
  }
  // El webhook debe recibir el origen del texto para decidir si hay voz de IA.
  const mapped = blocks.flatMap((block) => block.options?.responseVariableMapping ?? []);
  if (!mapped.some((entry) => entry.bodyPath === "data.textSource" && entry.variableId === TEXT_SOURCE_VARIABLE)) {
    fail("the flow must map data.textSource to decide whether to add the sales voice");
  }
  if (!mapped.some((entry) => entry.bodyPath === "data.renderedMessage")) {
    fail("the flow must map data.renderedMessage");
  }
  const setVariables = blocks.filter((block) => block.type === "Set variable");
  if (setVariables.length > 0) fail("the thin flow must not set variables");

  // El router puede usar Condition, pero SOLO para elegir la experiencia a
  // presentar: cualquier comparación sobre datos comerciales es lógica de negocio
  // y pertenece al backend.
  for (const block of blocks) {
    if (block.type !== "Condition") continue;
    const comparisons = (block.items ?? []).flatMap((item) => item.content?.comparisons ?? []);
    if (comparisons.length === 0) fail(`condition ${block.id} has no comparisons`);
    for (const comparison of comparisons) {
      if (!ROUTABLE_VARIABLES.has(comparison.variableId)) {
        fail(`condition ${block.id} decides on ${comparison.variableId}; the router may only route by backend metadata`);
      }
    }
  }

  // Arquitectura conversacional: el flujo debe estar organizado en módulos de
  // experiencia reconocibles, no en un único adaptador.
  const titles = flow.groups.map((group) => group.title ?? "");
  const requiredDomains = [
    "Bootstrap", "Bienvenida", "Menú principal", "Catálogo", "Categorías padre",
    "Subcategorías", "producto", "cantidad", "datos requeridos", "Resumen",
    "Confirmación", "Métodos de pago", "Mercado Pago", "Transferencia",
    "Comprobante", "Estado del pedido", "Preguntas frecuentes", "Soporte humano",
    "Navegación", "Errores", "Reanudación",
  ];
  for (const domain of requiredDomains) {
    if (!titles.some((title) => title.toLowerCase().includes(domain.toLowerCase()))) {
      fail(`the conversational architecture is missing the "${domain}" module`);
    }
  }
  if (flow.groups.length < requiredDomains.length) {
    fail(`expected at least ${requiredDomains.length} experience modules, found ${flow.groups.length}`);
  }
  return true;
}

export function loadThinFlow(path = DEFAULT_FLOW) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main() {
  validateThinTypebot(loadThinFlow(process.env.TYPEBOT_FLOW_PATH));
  console.log("Thin Typebot flow valid");
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
