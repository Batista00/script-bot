#!/usr/bin/env node
/**
 * Genera el SQL de publicación del flujo comercial de Typebot.
 *
 * La arquitectura obligatoria es:
 *
 *   WhatsApp -> Evolution -> Typebot -> Backend -> Typebot -> Evolution -> WhatsApp
 *
 * Typebot necesita dos valores de runtime que NO pueden vivir en el JSON
 * versionado:
 *
 *   - `backend_base_url`: no es secreto, pero se fija aquí para que el artefacto
 *     del repositorio no dependa de la instalación concreta.
 *   - `backend_token`: la credencial machine (`bw_...`) con la que Typebot llama
 *     a https://api.pablete.xyz. Se inyecta desde el entorno y nunca se escribe
 *     en el repositorio ni en la salida de este script.
 *
 * Uso:
 *   TYPEBOT_BACKEND_TOKEN=bw_... node typebot/publish-typebot.mjs \
 *     | docker exec -i <contenedor-postgres-typebot> psql -U <user> -d <db>
 *
 * El SQL actualiza la fila viva de `Typebot` y su instantánea publicada
 * (`PublicTypebot`), que es la que sirve el viewer en
 * `/api/v1/typebots/{publicId}/startChat`.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const BACKEND_BASE_URL = "https://api.pablete.xyz";
export const BASE_URL_VARIABLE = "vbackendbaseurl";
export const TOKEN_VARIABLE = "vbackendtoken";

/** Falla con un mensaje explícito en lugar de publicar un flujo inservible. */
function fail(message) {
  throw new Error(`Typebot publish invalid: ${message}`);
}

function quoteJson(value) {
  // Etiqueta improbable en el contenido para no romper el literal.
  const tag = "$bwflow$";
  const json = JSON.stringify(value);
  if (json.includes(tag)) fail("JSON contains the dollar-quote tag");
  return `${tag}${json}${tag}`;
}

/**
 * Inyecta los valores de runtime en las variables del flujo.
 * Devuelve una copia; el artefacto de entrada no se modifica.
 */
export function withRuntimeVariables(flow, { backendToken, backendBaseUrl = BACKEND_BASE_URL }) {
  if (typeof backendToken !== "string" || backendToken.trim().length === 0) {
    fail("backend token is required (TYPEBOT_BACKEND_TOKEN)");
  }
  if (!/^bw_[A-Za-z0-9_-]{8,}$/.test(backendToken.trim())) {
    fail("backend token must look like a machine credential (bw_...)");
  }
  const variables = flow.variables;
  if (!Array.isArray(variables)) fail("flow has no variables array");

  const target = [BASE_URL_VARIABLE, TOKEN_VARIABLE];
  const seen = new Set();
  const injected = variables.map((variable) => {
    if (!target.includes(variable.id)) return variable;
    seen.add(variable.id);
    return {
      ...variable,
      value: variable.id === BASE_URL_VARIABLE ? backendBaseUrl : backendToken.trim(),
    };
  });
  for (const id of target) {
    if (!seen.has(id)) fail(`flow does not declare ${id}`);
  }
  return { ...flow, variables: injected };
}

/** Artefacto JSON del flujo, tal como se versiona en el repositorio. */
export function loadFlow(path = process.env.TYPEBOT_FLOW_PATH ?? resolve(here, "bot-whatsap-thin-v1.json")) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * El flujo versionado no debe contener secretos: la única variable de
 * credencial tiene que estar vacía antes de la inyección.
 */
export function assertNoEmbeddedSecret(flow) {
  for (const variable of flow.variables ?? []) {
    if (variable.id !== TOKEN_VARIABLE) continue;
    const value = variable.value;
    if (value === undefined || value === null || value === "") return;
    fail(`${TOKEN_VARIABLE} must be empty in the repository artifact`);
  }
}

export function buildPublishSql(flow, options) {
  const published = withRuntimeVariables(flow, options);
  const publicId = options.publicId;
  if (typeof publicId !== "string" || publicId.length === 0) {
    fail("target publicId is required (TYPEBOT_PUBLIC_ID)");
  }
  if (publicId.includes("'")) fail("publicId must not contain quotes");

  const groups = quoteJson(published.groups);
  const edges = quoteJson(published.edges ?? []);
  const variables = quoteJson(published.variables);
  const events = quoteJson(published.events ?? null);
  const version = String(published.version ?? "6.1");
  const name = String(options.name ?? "BW - Agente comercial WhatsApp").replace(/'/g, "''");

  // `theme` y `settings` NO se tocan: el artefacto de autoría los trae vacíos y
  // sobrescribirlos cambiaría la apariencia del chat ya desplegado. El resto de
  // columnas (workspace, carpeta, icono, dominio) siguen perteneciendo al bot vivo.
  return [
    "BEGIN;",
    `UPDATE "Typebot" SET`,
    `  name = '${name}',`,
    `  groups = ${groups},`,
    `  edges = ${edges},`,
    `  variables = ${variables},`,
    `  events = ${events},`,
    `  version = '${version}',`,
    `  "updatedAt" = NOW()`,
    `WHERE "publicId" = '${publicId}';`,
    `UPDATE "PublicTypebot" SET`,
    `  groups = ${groups},`,
    `  edges = ${edges},`,
    `  variables = ${variables},`,
    `  events = ${events},`,
    `  version = '${version}',`,
    `  "updatedAt" = NOW()`,
    `WHERE "typebotId" = (SELECT id FROM "Typebot" WHERE "publicId" = '${publicId}');`,
    "COMMIT;",
    "",
  ].join("\n");
}

function main() {
  const flow = loadFlow();
  assertNoEmbeddedSecret(flow);
  const sql = buildPublishSql(flow, {
    backendToken: process.env.TYPEBOT_BACKEND_TOKEN ?? "",
    backendBaseUrl: process.env.TYPEBOT_BACKEND_BASE_URL ?? BACKEND_BASE_URL,
    publicId: process.env.TYPEBOT_PUBLIC_ID ?? "",
    name: process.env.TYPEBOT_NAME,
  });
  process.stdout.write(sql);
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
