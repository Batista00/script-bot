// Validador offline de los workflows n8n de BOT WHATSAP.
//
// n8n es solo capa de automatizacion/notificacion: consume APIs HTTP del backend
// y notifica. Este validador comprueba estructura importable, referencias entre
// nodos, ausencia de secretos/URLs hardcodeadas y ausencia total de acceso
// directo a base de datos.
//
// La logica reutilizable vive en funciones puras exportadas. La lectura de
// archivos, la validacion real y la impresion por consola ocurren SOLO cuando
// este modulo se ejecuta directamente como CLI, nunca al importarlo.
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workflowsDirectoryUrl = new URL("./", import.meta.url);
const modulePath = fileURLToPath(import.meta.url);

const REQUIRED_WORKFLOW_FIELDS = [
  "name",
  "nodes",
  "connections",
  "settings",
  "pinData",
  "versionId",
  "meta",
  "tags",
];

/** Variables de entorno documentadas para estos workflows. */
const ALLOWED_ENV_VARIABLES = new Set([
  "BACKEND_BASE_URL",
  "BUSINESS_ID",
  "BACKEND_BOT_TOKEN",
  "ALERT_WEBHOOK_URL",
  "JOB_ID",
]);

const ENV_EXPRESSION = /\{\{\s*\$env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const BEARER_EXPRESSION = /^\{\{\s*\$env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/;

const SECRET_CONTENT_PATTERNS = [
  { label: "machine credential (bw_)", regex: /\bbw_[A-Za-z0-9_-]{8,}\b/ },
  { label: "OpenAI-style key (sk-)", regex: /\bsk-[A-Za-z0-9_-]{8,}\b/ },
  { label: "Mercado Pago access token (APP_USR-)", regex: /\bAPP_USR-[A-Za-z0-9_-]{4,}\b/ },
  { label: "literal access_token/apiKey assignment", regex: /\b(?:access[_-]?token|api[_-]?key)\s*[=:]\s*["']?[A-Za-z0-9._-]{8,}/i },
];

const SECRET_KEY_NAMES = /^(?:access[_-]?token|api[_-]?key|apikey|client[_-]?secret|webhook[_-]?secret|password)$/i;

const FORBIDDEN_NODE_TYPE =
  /(?:^|\.)(?:postgres|mySql|mariadb|mssql|oracle|sqlite|executeQuery|cockroachdb|questDb)$/i;

const SQL_WRITE_STATEMENT =
  /\b(?:INSERT\s+INTO|UPDATE\s+[\w".]+\s+SET|DELETE\s+FROM|TRUNCATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+TABLE|GRANT\s+\w|REVOKE\s+\w)/i;

const HTTP_REQUEST_NODE = "n8n-nodes-base.httpRequest";

function fail(message) {
  throw new Error(`n8n workflow invalid: ${message}`);
}

/** Quita los tramos de expresion `{{ ... }}` para inspeccionar solo texto literal. */
export function stripExpressions(value) {
  return String(value).replace(/\{\{[\s\S]*?\}\}/g, "");
}

/** True si el string es exactamente una expresion `{{$env.NAME}}` (con `=` opcional). */
export function readEnvExpression(value) {
  if (typeof value !== "string") return null;
  const body = value.startsWith("=") ? value.slice(1) : value;
  const match = /^\{\{\s*\$env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/.exec(body);
  return match ? match[1] : null;
}

/** Recorre un valor y entrega cada string con su ruta. Funcion pura. */
export function collectStrings(value, path = "$", out = []) {
  if (typeof value === "string") {
    out.push({ path, value });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStrings(item, `${path}[${index}]`, out));
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      collectStrings(child, `${path}.${key}`, out);
    }
  }
  return out;
}

function nodeLabel(node) {
  return node?.name ?? node?.id ?? "unnamed";
}

export function assertWorkflowShape(workflow, sourceLabel = "workflow") {
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    fail(`${sourceLabel} must be a JSON object`);
  }
  for (const field of REQUIRED_WORKFLOW_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(workflow, field)) {
      fail(`${sourceLabel} is missing required field ${field}`);
    }
  }
  if (typeof workflow.name !== "string" || workflow.name.trim() === "") {
    fail(`${sourceLabel} must define a non-empty name`);
  }
  if (typeof workflow.versionId !== "string" || workflow.versionId.trim() === "") {
    fail(`${sourceLabel} must define a non-empty versionId`);
  }
  for (const field of ["settings", "pinData", "meta", "connections"]) {
    if (
      !workflow[field] ||
      typeof workflow[field] !== "object" ||
      Array.isArray(workflow[field])
    ) {
      fail(`${sourceLabel}.${field} must be an object`);
    }
  }
  if (!Array.isArray(workflow.tags)) fail(`${sourceLabel}.tags must be an array`);
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) {
    fail(`${sourceLabel}.nodes must be a non-empty array`);
  }
  return workflow;
}

export function assertNodeShapes(workflow) {
  const names = new Set();
  const ids = new Set();
  for (const node of workflow.nodes) {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      fail("every node must be a JSON object");
    }
    if (typeof node.id !== "string" || node.id.trim() === "") {
      fail(`node ${nodeLabel(node)} must define a non-empty id`);
    }
    if (typeof node.name !== "string" || node.name.trim() === "") {
      fail(`node ${node.id} must define a non-empty name`);
    }
    if (typeof node.type !== "string" || !node.type.includes(".")) {
      fail(`node ${node.name} must define a valid type`);
    }
    if (typeof node.typeVersion !== "number") {
      fail(`node ${node.name} must define a numeric typeVersion`);
    }
    if (!node.parameters || typeof node.parameters !== "object" || Array.isArray(node.parameters)) {
      fail(`node ${node.name} must define an object parameters`);
    }
    if (!Array.isArray(node.position) || node.position.length !== 2) {
      fail(`node ${node.name} must define a position of two coordinates`);
    }
    if (names.has(node.name)) fail(`duplicate node name ${node.name}`);
    if (ids.has(node.id)) fail(`duplicate node id ${node.id}`);
    names.add(node.name);
    ids.add(node.id);
  }
  return workflow;
}

export function assertConnections(workflow) {
  const names = new Set(workflow.nodes.map((node) => node.name));
  for (const [source, outputs] of Object.entries(workflow.connections)) {
    if (!names.has(source)) {
      fail(`connections reference missing source node ${source}`);
    }
    if (!outputs || typeof outputs !== "object" || Array.isArray(outputs)) {
      fail(`connections for ${source} must be an object`);
    }
    for (const [outputType, branches] of Object.entries(outputs)) {
      if (!Array.isArray(branches)) {
        fail(`connections.${source}.${outputType} must be an array`);
      }
      for (const branch of branches) {
        if (!Array.isArray(branch)) {
          fail(`connections.${source}.${outputType} branch must be an array`);
        }
        for (const connection of branch) {
          if (!connection || typeof connection.node !== "string") {
            fail(`connections.${source} has a connection without node`);
          }
          if (!names.has(connection.node)) {
            fail(`connections.${source} references missing node ${connection.node}`);
          }
        }
      }
    }
  }
  return workflow;
}

export function assertKnownEnvironment(workflow) {
  for (const { path, value } of collectStrings(workflow)) {
    for (const match of value.matchAll(ENV_EXPRESSION)) {
      if (!ALLOWED_ENV_VARIABLES.has(match[1])) {
        fail(`unknown environment variable $env.${match[1]} at ${path}`);
      }
    }
  }
  return workflow;
}

export function assertNoHardcodedAddresses(workflow) {
  const addressPatterns = [
    { label: "absolute URL", regex: /https?:\/\//i },
    { label: "localhost", regex: /localhost/i },
    { label: "IPv4 address", regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/ },
    { label: "pablete.xyz domain", regex: /pablete\.xyz/i },
  ];
  for (const { path, value } of collectStrings(workflow)) {
    const literal = stripExpressions(value);
    for (const { label, regex } of addressPatterns) {
      if (regex.test(literal)) {
        fail(`hardcoded ${label} detected at ${path}`);
      }
    }
  }
  return workflow;
}

export function assertNoSecrets(workflow) {
  for (const { path, value } of collectStrings(workflow)) {
    for (const { label, regex } of SECRET_CONTENT_PATTERNS) {
      if (regex.test(value)) fail(`${label} detected at ${path}`);
    }
    for (const match of value.matchAll(/Bearer\s+([^\s"']+)/gi)) {
      const token = match[1].replace(/^=/, "");
      if (!BEARER_EXPRESSION.test(token)) {
        fail(`literal Bearer secret detected at ${path}`);
      }
    }
  }

  const inspectKeys = (value, path) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => inspectKeys(item, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (
        SECRET_KEY_NAMES.test(key) &&
        typeof child === "string" &&
        child.trim() !== "" &&
        readEnvExpression(child) === null
      ) {
        fail(`literal secret value at ${path}.${key}`);
      }
      inspectKeys(child, `${path}.${key}`);
    }
  };
  inspectKeys(workflow, "$");
  return workflow;
}

export function assertNoWriteNodes(workflow) {
  for (const node of workflow.nodes) {
    if (FORBIDDEN_NODE_TYPE.test(node.type)) {
      fail(`node ${node.name} uses forbidden database node type ${node.type}`);
    }
    for (const { path, value } of collectStrings(node.parameters, `$.${node.name}.parameters`)) {
      if (SQL_WRITE_STATEMENT.test(value)) {
        fail(`node ${node.name} contains a raw SQL write statement at ${path}`);
      }
    }
  }
  return workflow;
}

export function assertBackendTrafficUsesEnv(workflow) {
  for (const node of workflow.nodes) {
    if (node.type !== HTTP_REQUEST_NODE) continue;
    const url = node.parameters?.url;
    if (typeof url !== "string" || url.trim() === "") {
      fail(`HTTP node ${node.name} must define a url`);
    }
    const body = url.startsWith("=") ? url.slice(1) : url;
    if (readEnvExpression(body) === "ALERT_WEBHOOK_URL") continue;
    if (!body.startsWith("{{$env.BACKEND_BASE_URL}}")) {
      fail(`HTTP node ${node.name} must target {{$env.BACKEND_BASE_URL}}`);
    }
    const headerParameters = node.parameters?.headerParameters?.parameters ?? [];
    const authorization = headerParameters.find(
      (header) => typeof header?.name === "string" && header.name.toLowerCase() === "authorization",
    );
    const authorizationValue = String(authorization?.value ?? "").replace(/^=/, "");
    const authorizationEnv = readEnvExpression(authorizationValue.replace(/^Bearer\s+/i, ""));
    if (authorizationEnv !== "BACKEND_BOT_TOKEN") {
      fail(`HTTP node ${node.name} must send Authorization: Bearer {{$env.BACKEND_BOT_TOKEN}}`);
    }
  }
  return workflow;
}

/** Valida un workflow ya parseado. Funcion pura; no lee archivos ni imprime. */
export function validateWorkflowDocument(workflow, sourceLabel = "workflow") {
  assertWorkflowShape(workflow, sourceLabel);
  assertNodeShapes(workflow);
  assertConnections(workflow);
  assertKnownEnvironment(workflow);
  assertNoHardcodedAddresses(workflow);
  assertNoSecrets(workflow);
  assertNoWriteNodes(workflow);
  assertBackendTrafficUsesEnv(workflow);
  return workflow;
}

/** Valida un workflow desde texto JSON. Funcion pura; no lee archivos ni imprime. */
export function validateWorkflowJson(raw, sourceLabel = "workflow") {
  let workflow;
  try {
    workflow = JSON.parse(raw);
  } catch (error) {
    fail(`invalid JSON in ${sourceLabel}: ${error.message}`);
  }
  return validateWorkflowDocument(workflow, sourceLabel);
}

/** Lista los archivos `*.json` del directorio de workflows. */
export async function listWorkflowFiles(directoryUrl = workflowsDirectoryUrl) {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
}

/** Lee y valida todos los workflows del directorio. Devuelve un resumen. */
export async function validateWorkflowDirectory(directoryUrl = workflowsDirectoryUrl) {
  const files = await listWorkflowFiles(directoryUrl);
  if (files.length === 0) fail("no workflow JSON files found");
  const names = new Set();
  const summaries = [];
  for (const file of files) {
    const raw = await readFile(new URL(file, directoryUrl), "utf8");
    const workflow = validateWorkflowJson(raw, file);
    if (names.has(workflow.name)) fail(`duplicate workflow name ${workflow.name}`);
    names.add(workflow.name);
    summaries.push({ file, name: workflow.name, nodes: workflow.nodes.length });
  }
  return summaries;
}

async function main() {
  await validateWorkflowDirectory(workflowsDirectoryUrl);
  console.log("n8n workflows valid");
}

const isDirectExecution =
  typeof process.argv[1] === "string" && resolve(process.argv[1]) === modulePath;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
