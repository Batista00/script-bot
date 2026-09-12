import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  validateTypebotDocument,
  validateTypebotSemantics,
  validateTypebotTemplate,
} from "./validate-typebot.mjs";

const templateUrl = new URL("./bot-whatsap-commerce-v1.legacy.json", import.meta.url);
const validatorPath = fileURLToPath(new URL("./validate-typebot.mjs", import.meta.url));

const template = JSON.parse(await readFile(templateUrl, "utf8"));
const blocks = () => structuredClone(template.groups.flatMap((group) => group.blocks ?? []));

test("current template satisfies Typebot semantic constraints", () => {
  assert.doesNotThrow(() => validateTypebotSemantics(blocks()));
});

test("validator rejects Equal to empty string conditions", () => {
  const mutated = blocks();
  const comparison = mutated.flatMap((block) => block.items ?? [])
    .flatMap((item) => item.content?.comparisons ?? [])[0];
  comparison.comparisonOperator = "Equal to";
  comparison.value = "";
  assert.throws(() => validateTypebotSemantics(mutated), /must use Is empty/);
});

test("validator rejects dotted array indexes", () => {
  const mutated = blocks();
  const webhook = mutated.find((block) =>
    block.options?.responseVariableMapping?.some((mapping) => mapping.bodyPath.includes("[0]")));
  webhook.options.responseVariableMapping[0].bodyPath = "data.0.productId";
  assert.throws(() => validateTypebotSemantics(mutated), /bracket notation/);
});

test("validator requires code mode and unquoted quantity interpolation", () => {
  const mutated = blocks();
  const quantity = mutated.find((block) => block.options?.variableId === "vquantity");
  quantity.options.isCode = false;
  assert.throws(() => validateTypebotSemantics(mutated), /enable isCode/);

  quantity.options.isCode = true;
  quantity.options.expressionToEvaluate =
    'Number.isInteger(Number("{{quantityInput}}")) && Number("{{quantityInput}}") > 0';
  assert.throws(() => validateTypebotSemantics(mutated), /unquoted quantityInput/);
});

test("pure document validator accepts the real template", () => {
  assert.doesNotThrow(() => validateTypebotDocument(structuredClone(template)));
});

test("pure template validator rejects invalid JSON", () => {
  assert.throws(() => validateTypebotTemplate("{ not json"), /invalid JSON/);
});

test("pure document validator rejects an invalid template", () => {
  const wrongVersion = structuredClone(template);
  wrongVersion.version = "5.0";
  assert.throws(() => validateTypebotDocument(wrongVersion), /version must be exactly 6.1/);

  const missingVariable = structuredClone(template);
  missingVariable.variables = missingVariable.variables.filter(({ name }) => name !== "checkoutUrl");
  assert.throws(
    () => validateTypebotDocument(missingVariable),
    /required variable checkoutUrl is missing/,
  );

  const duplicateIds = structuredClone(template);
  duplicateIds.variables.push({ ...duplicateIds.variables[0] });
  assert.throws(() => validateTypebotDocument(duplicateIds), /duplicate ID/);
});

test("importing the validator is silent and side-effect free", () => {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(validatorPath).href)})`],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("CLI execution validates the real template and exits 0", () => {
  const result = spawnSync(process.execPath, [validatorPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "Typebot template valid");
});

const findBlock = (document, id) =>
  document.groups.flatMap((group) => group.blocks ?? []).find((block) => block.id === id);

const groupById = (document, id) => document.groups.find((group) => group.id === id);

test("template reads fulfillment status through allowed read-only GET endpoints", () => {
  const single = structuredClone(template);
  groupById(single, "grppostventa").blocks.push({
    id: "blkfulfillmentsingle",
    type: "Webhook",
    options: {
      webhook: {
        url: "{{backend_base_url}}/bot/v1/orders/{{orderId}}/fulfillments",
        method: "GET",
        headers: [{
          id: "hdrsinglefulfillment",
          key: "Authorization",
          value: "Bearer {{backend_token}}",
        }],
      },
    },
  });
  assert.doesNotThrow(() => validateTypebotDocument(single));

  const dispatched = structuredClone(single);
  const block = findBlock(dispatched, "blkfulfillmentsingle");
  block.options.webhook.method = "POST";
  block.options.webhook.body = "{}";
  block.options.webhook.headers.push({
    id: "hdrctsingle", key: "Content-Type", value: "application/json",
  });
  assert.throws(() => validateTypebotDocument(dispatched), /must not dispatch fulfillments/);
});

test("validator rejects fulfillment sync and unlisted fulfillment endpoints", () => {
  const synced = structuredClone(template);
  groupById(synced, "grppostventa").blocks.push({
    id: "blkfulfillmentsync",
    type: "Webhook",
    options: {
      webhook: {
        url: "{{backend_base_url}}/bot/v1/orders/{{orderId}}/fulfillments/sync",
        method: "GET",
        headers: [{
          id: "hdrsyncfulfillment",
          key: "Authorization",
          value: "Bearer {{backend_token}}",
        }],
      },
    },
  });
  assert.throws(() => validateTypebotDocument(synced), /forbidden fulfillment endpoint/);
});

test("validator rejects a POST dispatch of the order fulfillments", () => {
  const dispatched = structuredClone(template);
  const block = findBlock(dispatched, "blkorderfulfillmentswebhook");
  block.options.webhook.method = "POST";
  block.options.webhook.body = "{}";
  block.options.webhook.headers.push({
    id: "hdrctdispatch", key: "Content-Type", value: "application/json",
  });
  assert.throws(() => validateTypebotDocument(dispatched), /must not dispatch fulfillments/);
});

test("a fixture that still uses the payments endpoints keeps passing", () => {
  const fixture = structuredClone(template);
  const urls = fixture.groups.flatMap((group) => group.blocks ?? [])
    .filter((block) => block.type === "Webhook")
    .map((block) => block.options.webhook.url);
  assert.ok(urls.includes("{{backend_base_url}}/bot/v1/orders/{{orderId}}/payments"));
  assert.ok(urls.includes("{{backend_base_url}}/bot/v1/payments/{{paymentId}}"));
  assert.doesNotThrow(() => validateTypebotDocument(fixture));
});

test("validator rejects Business and provider identifiers", () => {
  for (const marker of ["businessId", "providerServiceId", "provider_service_id", "externalServiceId"]) {
    const mutated = structuredClone(template);
    findBlock(mutated, "blkproductmenutext").content.richText[0].children[0].text = marker;
    assert.throws(
      () => validateTypebotDocument(mutated),
      /forbidden Business\/provider identifier/,
      marker,
    );
  }
});

test("validator rejects provider costs and API key fields", () => {
  for (const marker of ["providerCost", "provider_cost", "cost_price", "apiKey", "api_key"]) {
    const mutated = structuredClone(template);
    findBlock(mutated, "blkproductmenutext").content.richText[0].children[0].text = marker;
    assert.throws(
      () => validateTypebotDocument(mutated),
      /forbidden provider cost or credential field/,
      marker,
    );
  }
});

test("required Gateway endpoints cover the extended commerce flow", () => {
  const cases = [
    ["blkproductswebhook", "/bot/v1/products?limit=5&offset=0&type=service"],
    ["blkproductdetailwebhook", "/bot/v1/products/{{selectedProductId}}"],
    ["blkquotewebhook", "/bot/v1/quotes"],
    ["blkorderwebhook", "/bot/v1/orders"],
    ["blkorderquerywebhook", "/bot/v1/orders/{{orderId}}"],
    ["blkorderfulfillmentswebhook", "/bot/v1/orders/{{orderId}}/fulfillments"],
    ["blkpaymentmethodswebhook", "/bot/v1/payment-methods"],
    ["blkpaymentwebhook", "/bot/v1/orders/{{orderId}}/payments"],
    ["blkgetpaymentwebhook", "/bot/v1/payments/{{paymentId}}"],
  ];
  for (const [blockId, fragment] of cases) {
    const mutated = structuredClone(template);
    findBlock(mutated, blockId).options.webhook.url = "{{backend_base_url}}/bot/v1/unrelated";
    assert.throws(
      () => validateTypebotDocument(mutated),
      (error) => error.message.includes(`required Gateway endpoint is missing: ${fragment}`),
      fragment,
    );
  }
});

test("template never hardcodes provider keys and creates payments with paymentMethodId", () => {
  const raw = JSON.stringify(template);
  assert.ok(!raw.includes("mercado_pago"));
  assert.ok(!raw.includes("providerKey"));
  const webhook = findBlock(template, "blkpaymentwebhook").options.webhook;
  assert.ok(webhook.body.includes("{{selectedPaymentMethodId}}"));
  assert.ok(!webhook.body.includes("providerKey"));
  const idempotency = webhook.headers.find(({ key }) => key === "Idempotency-Key");
  assert.equal(idempotency.value, "{{paymentIdempotencyKey}}");
  const idempotencyBlock = findBlock(template, "blksetpaymentidempotency");
  assert.ok(idempotencyBlock.options.expressionToEvaluate.includes("{{orderId}}"));
});

test("fulfillmentInput is built generically from backend-provided keys", () => {
  const builder = findBlock(template, "blkbuildfulfillmentinput");
  assert.equal(builder.options.isCode, true);
  assert.match(builder.options.expressionToEvaluate, /selectedInput1Key/);
  assert.match(builder.options.expressionToEvaluate, /selectedInput2Key/);
  assert.match(builder.options.expressionToEvaluate, /selectedInput3Key/);
  // Debe devolver una CADENA JSON y el cuerpo del pedido debe citarla.
  // Typebot no puede inyectar objetos anidados: al interpolar un objeto el
  // cuerpo deja de ser JSON válido (400). El backend acepta la cadena JSON y la
  // normaliza (comprobado contra producción).
  assert.match(builder.options.expressionToEvaluate, /JSON\.stringify/);
  assert.match(builder.options.expressionToEvaluate, /Object\.assign/);
  assert.doesNotMatch(builder.options.expressionToEvaluate, /targetUrl|instagram|telegram/i);
});

test("quantity is validated against the backend min and max", () => {
  const quantityCheck = findBlock(template, "blkquantitycondition");
  assert.ok(quantityCheck.items.some((item) => item.content.comparisons.some(
    ({ variableId, value }) => variableId === "vquantityvalid" && value === "false",
  )));
});

test("order flow reuses the error path when a quote was already converted", () => {
  const orderCheck = findBlock(template, "blkordercheck");
  const item = orderCheck.items.find(({ id }) => id === "itmorderalreadyconverted");
  assert.ok(item);
  assert.equal(item.content.comparisons[0].value, "QUOTE_ALREADY_CONVERTED");
  const body = findBlock(template, "blkorderwebhook").options.webhook.body;
  assert.ok(body.includes("{{fulfillmentInput}}"));
});

test("post-sale status and transfer handoff are present", () => {
  assert.ok(findBlock(template, "blkorderquerywebhook"));
  assert.ok(findBlock(template, "blkorderfulfillmentswebhook"));
  assert.ok(findBlock(template, "blkfulfillmentproblemtext"));
  assert.ok(findBlock(template, "blkbanksummarytext"));
  assert.ok(findBlock(template, "blkmainmenuchoices"));
  assert.ok(findBlock(template, "blkhumanchoices"));
});

test("validator rejects statement expressions that the Typebot sandbox cannot evaluate", () => {
  const mutated = structuredClone(template);
  const block = mutated.groups.flatMap((group) => group.blocks ?? [])
    .find((candidate) => candidate.options?.expressionToEvaluate);
  block.options.expressionToEvaluate = "(function(){var x=1;return String(x);})()";
  assert.throws(() => validateTypebotDocument(mutated),
    /uses a statement expression/);
});

test("validator rejects response mappings outside the data envelope", () => {
  const mutated = structuredClone(template);
  const webhook = mutated.groups.flatMap((group) => group.blocks ?? [])
    .find((block) =>
      block.options?.responseVariableMapping?.some((mapping) => mapping.bodyPath.startsWith("data.")));
  webhook.options.responseVariableMapping[0].bodyPath = "error.code";
  assert.throws(() => validateTypebotDocument(mutated),
    /outside the data envelope/);
});

test("commerce template keeps every backend error mapping inside the data envelope", () => {
  const paths = blocks().flatMap((block) => block.options?.responseVariableMapping ?? [])
    .map((mapping) => mapping.bodyPath);
  const errorPaths = paths.filter((path) => path.includes("error"));
  assert.ok(errorPaths.length > 0, "template must map backend errors");
  for (const path of errorPaths) assert.match(path, /^data\.error\./);
});

test("commerce template only uses plain expressions in Set variable blocks", () => {
  const expressions = blocks()
    .filter((block) => block.type === "Set variable")
    .map((block) => block.options?.expressionToEvaluate)
    .filter((expression) => typeof expression === "string");
  assert.ok(expressions.length > 0);
  for (const expression of expressions) {
    assert.doesNotMatch(expression, /(^|[^A-Za-z0-9_$])(var|let|const|function|return|for|while)\b/);
  }
});

test("validator rejects an unquoted fulfillmentInput placeholder in a webhook body", () => {
  const mutated = structuredClone(template);
  const webhook = mutated.groups.flatMap((group) => group.blocks ?? [])
    .find((block) => typeof block.options?.webhook?.body === "string"
      && block.options.webhook.body.includes("{{fulfillmentInput}}"));
  webhook.options.webhook.body = webhook.options.webhook.body
    .replace('"{{fulfillmentInput}}"', "{{fulfillmentInput}}");
  assert.throws(() => validateTypebotDocument(mutated),
    /must quote the fulfillmentInput placeholder/);
});

test("commerce template quotes the fulfillmentInput placeholder", () => {
  const bodies = blocks()
    .map((block) => block.options?.webhook?.body)
    .filter((body) => typeof body === "string" && body.includes("{{fulfillmentInput}}"));
  assert.ok(bodies.length > 0, "order webhook must send fulfillmentInput");
  for (const body of bodies) {
    assert.match(body, /"fulfillmentInput": "\{\{fulfillmentInput\}\}"/);
  }
});

test("catalog and payment menus render only the entries returned by the backend", () => {
  const productText = findBlock(template, "blkproductmenutext");
  const methodText = findBlock(template, "blkmethodstext");
  const text = (block) => block.content.richText.flatMap((node) =>
    (node.children ?? []).map((child) => child.text ?? "")).join("");
  // Las ranuras vacias producian entradas "3. " sin nombre cuando el negocio
  // tiene menos metodos o productos que ranuras fijas.
  assert.match(text(productText), /\{\{productsList\}\}/);
  assert.doesNotMatch(text(productText), /\{\{product5Name\}\}/);
  assert.match(text(methodText), /\{\{paymentMethodsList\}\}/);
  assert.doesNotMatch(text(methodText), /\{\{paymentMethod3Name\}\}/);

  const productsList = findBlock(template, "blkproductslist").options.expressionToEvaluate;
  const methodsList = findBlock(template, "blkmethodslist").options.expressionToEvaluate;
  for (const expression of [productsList, methodsList]) {
    assert.match(expression, /Name\}\} \? /);
  }
});

test("post-sale status resolves the customer's real order from the backend", () => {
  const group = groupById(template, "grppostventa");
  const lookup = group.blocks.find((block) => block.id === "blklatestorderwebhook");
  assert.ok(lookup, "post-sale must look the order up by customer");
  assert.equal(lookup.options.webhook.method, "GET");
  assert.match(lookup.options.webhook.url, /\/bot\/v1\/operations\/orders\?limit=1&customerId=\{\{customerId\}\}$/);
  assert.deepEqual(lookup.options.responseVariableMapping,
    [{ id: "latest-order-id", bodyPath: "data[0].orderId", variableId: "vorderid" }]);
  // Debe ejecutarse antes de decidir si hay pedido.
  assert.equal(group.blocks[0].id, "blklatestorderwebhook");
});

test("fulfillment status reads naturally when no preparation is registered", () => {
  const group = groupById(template, "grpfulfillmentinfo");
  const builder = group.blocks.find((block) => block.id === "blkfulfillmentstatustext");
  assert.ok(builder, "fulfillment info must compute its text");
  assert.match(builder.options.expressionToEvaluate, /Todavía no hay preparación registrada/);
  const text = group.blocks.find((block) => block.type === "text");
  const rendered = text.content.richText.flatMap((node) =>
    (node.children ?? []).map((child) => child.text ?? "")).join("");
  assert.match(rendered, /\{\{fulfillmentStatusText\}\}/);
  // Un estado vacio ya no puede imprimir "**".
  assert.doesNotMatch(rendered, /\{\{fulfillmentStatus\}\}/);
});
