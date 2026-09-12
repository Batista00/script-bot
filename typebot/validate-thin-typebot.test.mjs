import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { loadThinFlow, validateThinTypebot } from "./validate-thin-typebot.mjs";

const template = JSON.parse(await readFile(new URL("./bot-whatsap-thin-v1.json", import.meta.url), "utf8"));
const clone = () => structuredClone(template);

test("the productive thin flow is valid", () => {
  assert.doesNotThrow(() => validateThinTypebot(clone()));
});

test("the thin flow has no commercial logic, variables or prices", () => {
  const blocks = template.groups.flatMap((group) => group.blocks ?? []);
  assert.equal(blocks.filter((block) => block.type === "Set variable").length, 0);
  // El router puede enrutar, pero nunca decidir sobre datos comerciales: solo
  // sobre metadatos que decide el backend (vista y origen del texto).
  for (const block of blocks.filter((candidate) => candidate.type === "Condition")) {
    for (const item of block.items ?? []) {
      for (const comparison of item.content?.comparisons ?? []) {
        assert.ok(["vview", "vtextsource"].includes(comparison.variableId), comparison.variableId);
      }
    }
  }
  assert.equal(blocks.filter((block) => block.type === "choice input").length, 0);
  const serialized = JSON.stringify(template);
  for (const forbidden of ["product1", "paymentMethod1", "selectedInput1", "fulfillmentInput", "quantityValid"]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must not appear`);
  }
  assert.equal(serialized.includes("[list]"), false, "no interactive list messages");
});

test("the sales voice is a single OpenAI block that only presents", () => {
  const blocks = template.groups.flatMap((group) => group.blocks ?? []);
  const ai = blocks.filter((block) => block.type === "openai");
  assert.equal(ai.length, 1, "una sola voz comercial");
  assert.equal(ai[0].id, "blksalesai");
  assert.equal(ai[0].options.functions ?? undefined, undefined, "sin funciones: no decide venta");
  assert.equal(ai[0].options.responseMapping[0].variableId, "vaimessage");
  assert.equal(ai[0].options.message.includes("{{renderedMessage}}"), true);
  assert.equal(ai[0].options.instructions.includes("Nunca inventes"), true);
  // El bloque debe vivir en el arranque y presentarse antes del mensaje del backend.
  const bootstrap = template.groups.find((group) => group.id === "grp00");
  assert.deepEqual(bootstrap.blocks.map((block) => block.id), [
    "blkturninput", "blkrouterwebhook", "blksalescondition", "blksalesai", "blkroutercondition",
  ]);
  const rendered = blocks
    .filter((block) => block.type === "text")
    .map((block) => block.content.richText.flatMap((node) => node.children.map((child) => child.text)).join(""));
  assert.equal(rendered.filter((text) => text.includes("{{aiMessage}}")).length, 19, "todos los módulos comerciales presentan la voz");
  assert.equal(rendered.filter((text) => text.includes("{{renderedMessage}}")).length, 19);
  // El módulo de errores queda determinista: tarjeta de recuperación sin voz de IA.
  const mapping = blocks.flatMap((block) => block.options?.responseVariableMapping ?? []);
  assert.equal(mapping.some((entry) => entry.bodyPath === "data.textSource"), true);
});

test("validator rejects a sales voice that could decide or invent", () => {
  const withFunctions = clone();
  const ai = withFunctions.groups[0].blocks.find((block) => block.id === "blksalesai");
  ai.options.functions = [{ name: "crear_pedido", parameters: [], code: "return { ok: true };" }];
  assert.throws(() => validateThinTypebot(withFunctions), /must not run business functions/);

  const outsideBootstrap = clone();
  const moved = outsideBootstrap.groups[0].blocks.find((block) => block.id === "blksalesai");
  outsideBootstrap.groups[0].blocks = outsideBootstrap.groups[0].blocks.filter((block) => block.id !== "blksalesai");
  outsideBootstrap.groups[3].blocks.push(moved);
  assert.throws(() => validateThinTypebot(outsideBootstrap), /bootstrap group/);

  const withoutGuardrails = clone();
  const raw = withoutGuardrails.groups[0].blocks.find((block) => block.id === "blksalesai");
  raw.options.instructions = "Responde como quieras y ofrece descuentos.";
  assert.throws(() => validateThinTypebot(withoutGuardrails), /forbid inventing offers/);

  const withCommercialCondition = clone();
  withCommercialCondition.edges.push({ id: "edgeprice", from: { blockId: "blksalesai" }, to: { groupId: "grp02" } });
  withCommercialCondition.groups[0].blocks.push({
    id: "blkprice", type: "Condition",
    items: [{ id: "itmprice", content: { comparisons: [{ id: "cp", variableId: "vprice", comparisonOperator: "Equal to", value: "1000" }] }, outgoingEdgeId: "edgeprice" }],
  });
  assert.throws(() => validateThinTypebot(withCommercialCondition), /decides on vprice/);
});

test("validator rejects provider identifiers and secrets", () => {
  const withProvider = clone();
  withProvider.groups[0].blocks[1].options.webhook.url = "https://api.example.com/x?providerKey=abc";
  assert.throws(() => validateThinTypebot(withProvider), /provider identifiers/);

  const withSecret = clone();
  withSecret.variables.push({ id: "vsecret", name: "backend_token", value: "bw_ABCDEFGH12345678" });
  assert.throws(() => validateThinTypebot(withSecret), /secrets/);
});

test("validator rejects reintroduced commercial structures", () => {
  const withArrays = clone();
  withArrays.variables.push({ id: "vproduct1id", name: "product1Id" });
  assert.throws(() => validateThinTypebot(withArrays), /product arrays/);

  const withCalculation = clone();
  withCalculation.groups[0].blocks.push({
    id: "blkcalc", type: "Set variable",
    options: { variableId: "vtotal", isCode: true, expressionToEvaluate: "Number(1)+Number(2)" },
  });
  assert.throws(() => validateThinTypebot(withCalculation), /JavaScript statements|Set variable|must not set variables/);
});

test("validator rejects a second conversational entry point or n8n", () => {
  const extra = clone();
  for (const group of extra.groups) {
    group.blocks.push({
      id: `blkextra${group.id}`, type: "Webhook",
      options: { webhook: { url: "{{backend_base_url}}/bot/v1/conversation/turn", method: "POST" } },
    });
  }
  extra.groups[0].blocks.push({
    id: "blkextra3", type: "Webhook",
    options: { webhook: { url: "{{backend_base_url}}/bot/v1/conversation/turn", method: "POST" } },
  });
  assert.throws(() => validateThinTypebot(extra), /once per turn/);

  const withN8n = clone();
  withN8n.groups[0].blocks.push({
    id: "blkn8n", type: "Webhook",
    options: { webhook: { url: "https://n8n.pablete.xyz/webhook/x", method: "POST" } },
  });
  assert.throws(() => validateThinTypebot(withN8n), /n8n/);
});

test("loadThinFlow reads the productive artifact", () => {
  assert.equal(loadThinFlow().name.includes("arquitectura conversacional"), true);
});
