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

const ALLOWED_BLOCKS = new Set(["text", "text input", "choice input", "Webhook"]);
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
  const conversation = endpoints.filter((url) => url.includes("/bot/v1/conversation/turn"));
  if (conversation.length !== 1) {
    fail(`the flow must call /bot/v1/conversation/turn exactly once (found ${conversation.length})`);
  }
  if (endpoints.some((url) => url.includes("n8n"))) fail("n8n must not appear in the flow");
  // El mensaje mostrado es la respuesta del backend, sin transformarla.
  const renders = blocks.filter((block) => block.type === "text").map((block) =>
    (block.content?.richText ?? []).flatMap((node) => (node.children ?? []).map((child) => child.text ?? "")).join(""));
  if (!renders.some((text) => text.includes("{{renderedMessage}}"))) {
    fail("the flow must display the backend renderedMessage");
  }
  const setVariables = blocks.filter((block) => block.type === "Set variable");
  if (setVariables.length > 0) fail("the thin flow must not set variables");
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
