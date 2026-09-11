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

const templateUrl = new URL("./bot-whatsap-commerce-v1.json", import.meta.url);
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
