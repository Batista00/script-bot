import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { validateTypebotSemantics } from "./validate-typebot.mjs";

const template = JSON.parse(await readFile(
  new URL("./bot-whatsap-commerce-v1.json", import.meta.url),
  "utf8",
));
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
