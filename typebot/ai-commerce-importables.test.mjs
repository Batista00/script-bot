import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const files = [
  "bot-whatsap-ai-commerce-v1.json",
  "bot-whatsap-ai-commerce-v1.before-prices.json",
];

for (const file of files) {
  test(`${file} is an importable Typebot 6.1 template without embedded secrets`, async () => {
    const raw = await readFile(new URL(`./${file}`, import.meta.url), "utf8");
    const template = JSON.parse(raw);

    assert.equal(template.version, "6.1");
    assert.ok(Array.isArray(template.events));
    assert.ok(Array.isArray(template.groups));
    assert.ok(Array.isArray(template.edges));
    assert.ok(Array.isArray(template.variables));
    assert.equal(/\bbw_[A-Za-z0-9_-]{8,}\b/.test(raw), false);
    assert.equal(/\bsk-[A-Za-z0-9_-]{20,}\b/.test(raw), false);
    assert.equal(/[0-9]{8,12}:[A-Za-z0-9_-]{20,}/.test(raw), false);

    const backendToken = template.variables.find(({ name }) => name === "backend_token");
    assert.ok(backendToken);
    assert.equal(backendToken.value, undefined);
  });
}

test("AI commerce template consumes the retail package endpoint", async () => {
  const raw = await readFile(
    new URL("./bot-whatsap-ai-commerce-v1.json", import.meta.url),
    "utf8",
  );

  assert.match(raw, /\/bot\/v1\/catalog\/packages\?categoryId=/);
});
