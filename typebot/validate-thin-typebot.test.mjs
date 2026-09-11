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
  assert.equal(blocks.filter((block) => block.type === "choice input").length, 0);
  const serialized = JSON.stringify(template);
  for (const forbidden of ["product1", "paymentMethod1", "selectedInput1", "fulfillmentInput", "quantityValid"]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must not appear`);
  }
  assert.equal(serialized.includes("[list]"), false, "no interactive list messages");
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
  assert.equal(loadThinFlow().name.includes("delgado"), true);
});
