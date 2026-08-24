import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizeProductInputs,
  validateCommercialInput,
} from "../src/modules/products/product-inputs.js";

const schema = normalizeProductInputs([
  {
    key: "targetUrl", label: "Enlace de publicación", helpText: "Usa HTTPS",
    type: "url", required: true, position: 0, validation: { maxLength: 2048 },
  },
  {
    key: "comments", label: "Comentarios", helpText: null,
    type: "textarea", required: true, position: 1,
    validation: { minLength: 1, maxLength: 10_000 },
  },
]);

test("commercial Product inputs are normalized and validated without provider knowledge", () => {
  assert.deepEqual(schema.map((field) => field.key), ["targetUrl", "comments"]);
  assert.deepEqual(validateCommercialInput(schema, {
    targetUrl: "https://instagram.com/p/example",
    comments: "Excelente\nMuy bueno",
  }), {
    targetUrl: "https://instagram.com/p/example",
    comments: "Excelente\nMuy bueno",
  });
});

test("commercial Product inputs reject missing, extra, invalid URL, and duplicate keys", () => {
  for (const input of [
    { comments: "Uno" },
    { targetUrl: "ftp://invalid", comments: "Uno" },
    { targetUrl: "https://example.com", comments: "Uno", apiKey: "forbidden" },
  ]) {
    assert.throws(() => validateCommercialInput(schema, input));
  }
  assert.throws(() => normalizeProductInputs([
    schema[0], { ...schema[0], position: 1 },
  ]));
});
