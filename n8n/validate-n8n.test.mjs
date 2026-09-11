import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  listWorkflowFiles,
  validateWorkflowDirectory,
  validateWorkflowDocument,
  validateWorkflowJson,
} from "./validate-n8n.mjs";

const directoryUrl = new URL("./", import.meta.url);
const validatorPath = fileURLToPath(new URL("./validate-n8n.mjs", import.meta.url));

const files = await listWorkflowFiles(directoryUrl);
const rawByFile = new Map();
for (const file of files) {
  rawByFile.set(file, await readFile(new URL(file, directoryUrl), "utf8"));
}

const clone = (file) => JSON.parse(rawByFile.get(file));
const httpNodes = (workflow) =>
  workflow.nodes.filter((node) => node.type === "n8n-nodes-base.httpRequest");

test("real workflows satisfy the validator", () => {
  assert.ok(files.length > 0, "expected at least one workflow JSON file");
  for (const file of files) {
    assert.doesNotThrow(() => validateWorkflowDocument(clone(file), file));
  }
});

test("directory validation returns a summary for every workflow", async () => {
  const summaries = await validateWorkflowDirectory(directoryUrl);
  assert.equal(summaries.length, files.length);
  for (const summary of summaries) {
    assert.ok(summary.name.length > 0);
    assert.ok(summary.nodes > 0);
  }
});

test("validator rejects a hardcoded absolute URL", () => {
  for (const hardcoded of [
    "=https://api.pablete.xyz/businesses/b1/jobs",
    "=http://localhost:3000/businesses/b1/jobs",
    "=http://10.0.0.7:3000/businesses/b1/jobs",
  ]) {
    const mutated = clone("alertas-operativas.json");
    httpNodes(mutated)[0].parameters.url = hardcoded;
    assert.throws(() => validateWorkflowDocument(mutated), /hardcoded/);
  }
});

test("validator rejects a literal machine token", () => {
  const mutated = clone("alertas-operativas.json");
  httpNodes(mutated)[0].parameters.headerParameters.parameters[0].value =
    "=Bearer bw_1234567890abcdef";
  assert.throws(() => validateWorkflowDocument(mutated), /machine credential/);

  const other = clone("reporte-diario.json");
  httpNodes(other)[0].parameters.headerParameters.parameters[0].value = "=Bearer literal-token-123";
  assert.throws(() => validateWorkflowDocument(other), /literal Bearer secret/);
});

test("validator rejects a literal secret in a credential-like key", () => {
  const mutated = clone("alertas-operativas.json");
  mutated.nodes[1].parameters.access_token = "APP_USR-1234567890-abcdef";
  assert.throws(() => validateWorkflowDocument(mutated), /Mercado Pago access token|literal secret/);
});

test("validator rejects a connection to a missing node", () => {
  const mutated = clone("alertas-operativas.json");
  const branch = Object.values(mutated.connections)[0].main[0][0];
  branch.node = "Nodo que no existe";
  assert.throws(() => validateWorkflowDocument(mutated), /references missing node/);
});

test("validator rejects a database write node", () => {
  const mutated = clone("alertas-operativas.json");
  mutated.nodes.push({
    parameters: { operation: "executeQuery", query: "DELETE FROM job_queue" },
    id: "0a1b2c3d-0001-4000-8000-00000000dead",
    name: "SQL directo",
    type: "n8n-nodes-base.postgres",
    typeVersion: 2.4,
    position: [900, 0],
  });
  assert.throws(() => validateWorkflowDocument(mutated), /forbidden database node type/);
});

test("validator rejects a raw SQL write hidden in a code node", () => {
  const mutated = clone("alertas-operativas.json");
  const codeNode = mutated.nodes.find((node) => node.type === "n8n-nodes-base.code");
  codeNode.parameters.jsCode = "await db.query('UPDATE orders SET status = 1');";
  assert.throws(() => validateWorkflowDocument(mutated), /raw SQL write/);
});

test("validator rejects backend traffic that avoids BACKEND_BASE_URL", () => {
  const mutated = clone("alertas-operativas.json");
  httpNodes(mutated)[0].parameters.url = "={{$env.ALERT_WEBHOOK_URL}}/jobs";
  assert.throws(() => validateWorkflowDocument(mutated), /must target \{\{\$env\.BACKEND_BASE_URL\}\}/);
});

test("validator rejects an unknown environment variable", () => {
  const mutated = clone("alertas-operativas.json");
  httpNodes(mutated)[0].parameters.url = "={{$env.OTHER_BASE_URL}}/businesses/x/jobs";
  assert.throws(() => validateWorkflowDocument(mutated), /unknown environment variable/);
});

test("validator rejects missing required workflow fields", () => {
  const mutated = clone("reporte-diario.json");
  delete mutated.settings;
  assert.throws(() => validateWorkflowDocument(mutated), /missing required field settings/);

  const noPinData = clone("reporte-diario.json");
  delete noPinData.pinData;
  assert.throws(() => validateWorkflowDocument(noPinData), /missing required field pinData/);
});

test("validator rejects malformed workflow JSON", () => {
  assert.throws(() => validateWorkflowJson("{ not json"), /invalid JSON/);
  assert.throws(() => validateWorkflowJson("[]"), /must be a JSON object/);
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

test("CLI execution validates every real workflow and exits 0", () => {
  const result = spawnSync(process.execPath, [validatorPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "n8n workflows valid");
});
