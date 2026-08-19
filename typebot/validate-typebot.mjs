import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const templateUrl = new URL("./bot-whatsap-commerce-v1.json", import.meta.url);
const templatePath = fileURLToPath(templateUrl);
const raw = await readFile(templateUrl, "utf8");

function fail(message) {
  throw new Error(`Typebot template invalid: ${message}`);
}

let template;
try {
  template = JSON.parse(raw);
} catch (error) {
  fail(`invalid JSON in ${templatePath}: ${error.message}`);
}

if (template.version !== "6.1") fail("version must be exactly 6.1");
for (const key of ["events", "groups", "edges", "variables"]) {
  if (!Array.isArray(template[key])) fail(`${key} must be an array`);
}
for (const key of ["theme", "settings"]) {
  if (!template[key] || typeof template[key] !== "object" || Array.isArray(template[key])) {
    fail(`${key} must be an object`);
  }
}

const allIds = new Set();
const duplicateIds = new Set();
function visit(value) {
  if (Array.isArray(value)) {
    for (const item of value) visit(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (typeof value.id === "string") {
    if (allIds.has(value.id)) duplicateIds.add(value.id);
    allIds.add(value.id);
  }
  for (const child of Object.values(value)) visit(child);
}
visit(template);
if (duplicateIds.size > 0) fail(`duplicate IDs: ${[...duplicateIds].join(", ")}`);

const eventIds = new Set(template.events.map(({ id }) => id));
const groupIds = new Set(template.groups.map(({ id }) => id));
const blocks = template.groups.flatMap((group) => group.blocks ?? []);
const blockIds = new Set(blocks.map(({ id }) => id));
const itemIds = new Set(blocks.flatMap((block) => block.items ?? []).map(({ id }) => id));
const edgeIds = new Set(template.edges.map(({ id }) => id));

for (const edge of template.edges) {
  if (!edge?.from || !edge?.to) fail(`edge ${edge.id} must have from and to`);
  if (edge.from.eventId && !eventIds.has(edge.from.eventId)) {
    fail(`edge ${edge.id} references missing event ${edge.from.eventId}`);
  }
  if (edge.from.blockId && !blockIds.has(edge.from.blockId)) {
    fail(`edge ${edge.id} references missing block ${edge.from.blockId}`);
  }
  if (edge.from.itemId && !itemIds.has(edge.from.itemId)) {
    fail(`edge ${edge.id} references missing item ${edge.from.itemId}`);
  }
  if (!groupIds.has(edge.to.groupId)) {
    fail(`edge ${edge.id} references missing target group ${edge.to.groupId}`);
  }
}

function validateOutgoing(value) {
  if (Array.isArray(value)) {
    for (const item of value) validateOutgoing(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (value.outgoingEdgeId && !edgeIds.has(value.outgoingEdgeId)) {
    fail(`${value.id ?? "element"} references missing edge ${value.outgoingEdgeId}`);
  }
  for (const child of Object.values(value)) validateOutgoing(child);
}
validateOutgoing(template);

const variableIds = new Set();
const variableNames = new Set();
for (const variable of template.variables) {
  if (!variable.id || !variable.name) fail("every variable must have id and name");
  if (variableIds.has(variable.id)) fail(`duplicate variable id ${variable.id}`);
  if (variableNames.has(variable.name)) fail(`duplicate variable name ${variable.name}`);
  variableIds.add(variable.id);
  variableNames.add(variable.name);
}

const requiredVariables = [
  "remoteJid", "pushName", "instanceName", "ownerJid", "serverUrl",
  "whatsappNumber", "backend_base_url", "backend_token", "customerId", "customerName",
  ...Array.from({ length: 5 }, (_, index) => index + 1).flatMap((slot) => [
    `product${slot}Id`, `product${slot}Name`, `product${slot}Min`, `product${slot}Max`,
  ]),
  "productSelection", "selectedProductId", "selectedProductName", "quantityInput", "quantity",
  "quoteId", "quoteProductName", "quoteQuantity", "quoteCurrency", "quoteTotal", "quoteStatus",
  "orderId", "orderStatus", "orderItemId", "orderTotal", "paymentId", "paymentStatus",
  "checkoutUrl", "paymentExpiresAt", "paymentIdempotencyKey",
];
for (const name of requiredVariables) {
  if (!variableNames.has(name)) fail(`required variable ${name} is missing`);
}

function validateVariableReferences(value, key = "") {
  if (Array.isArray(value)) {
    for (const item of value) validateVariableReferences(item, key);
    return;
  }
  if (typeof value === "string") {
    for (const match of value.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)) {
      if (!variableNames.has(match[1])) fail(`unknown variable reference {{${match[1]}}}`);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [childKey, child] of Object.entries(value)) {
    if (childKey === "variableId" && typeof child === "string" && !variableIds.has(child)) {
      fail(`unknown variableId ${child}`);
    }
    validateVariableReferences(child, childKey);
  }
}
validateVariableReferences(template);

const allowedBlockTypes = new Set([
  "text", "text input", "choice input", "Set variable", "Condition", "Webhook",
]);
for (const block of blocks) {
  if (!allowedBlockTypes.has(block.type)) fail(`unsupported block type ${block.type}`);
}

const webhooks = blocks.filter(({ type }) => type === "Webhook");
const requiredEndpointFragments = [
  "/bot/v1/customers/resolve",
  "/bot/v1/products?limit=5&offset=0&type=service",
  "/bot/v1/quotes",
  "/bot/v1/orders",
  "/bot/v1/orders/{{orderId}}/payments",
  "/bot/v1/payments/{{paymentId}}",
];
const webhookUrls = webhooks.map((block) => block.options?.webhook?.url);
for (const fragment of requiredEndpointFragments) {
  if (!webhookUrls.some((url) => url === `{{backend_base_url}}${fragment}`)) {
    fail(`required Gateway endpoint is missing: ${fragment}`);
  }
}
for (const block of webhooks) {
  const webhook = block.options?.webhook;
  if (!webhook?.url?.startsWith("{{backend_base_url}}/bot/v1/")) {
    fail(`Webhook ${block.id} does not use backend_base_url and /bot/v1`);
  }
  const headers = webhook.headers ?? [];
  const authorization = headers.find(({ key }) => key.toLowerCase() === "authorization");
  if (authorization?.value !== "Bearer {{backend_token}}") {
    fail(`Webhook ${block.id} has an invalid Authorization header`);
  }
  const method = webhook.method ?? (webhook.body ? "POST" : "GET");
  if (webhook.body) {
    const contentType = headers.find(({ key }) => key.toLowerCase() === "content-type");
    if (method !== "POST" || contentType?.value !== "application/json") {
      fail(`Webhook ${block.id} body must use POST application/json`);
    }
  }
}

const backendToken = template.variables.find(({ name }) => name === "backend_token");
const tokenSetBlock = blocks.find(
  (block) => block.type === "Set variable" && block.options?.variableId === backendToken.id,
);
if (tokenSetBlock) fail("backend_token must not be assigned by a Set variable block");
if (raw.includes("variablesForTest")) fail("variablesForTest are forbidden in this template");
if (/\bbw_[A-Za-z0-9_-]{8,}\b/.test(raw)) fail("a machine credential appears to be embedded");
for (const match of raw.matchAll(/Bearer\s+([^"\\]+)/gi)) {
  if (match[1].trim() !== "{{backend_token}}") fail("literal Bearer secret detected");
}
if (/\b(access[_-]?token|webhook[_-]?secret|smm[_-]?raja[_-]?(?:api)?[_-]?key)\b/i.test(raw)) {
  fail("provider credential field detected");
}
if (/localhost|pablete\.xyz|\b(?:\d{1,3}\.){3}\d{1,3}\b|docker[^\s\"/]*:3000/i.test(raw)) {
  fail("hardcoded deployment address detected");
}
if (/businessId|provider_service_id|providerServiceId|\/fulfillments/i.test(raw)) {
  fail("forbidden Business/provider/Fulfillment concept detected");
}

console.log("Typebot template valid");
