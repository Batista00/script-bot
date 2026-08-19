import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const requiredKeys = [
  "NODE_ENV",
  "PORT",
  "DATABASE_URL",
  "LOG_LEVEL",
  "AUTH_SESSION_TTL_HOURS",
  "INTEGRATIONS_ENCRYPTION_KEY",
  "PUBLIC_API_BASE_URL",
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "BACKEND_BIND_ADDRESS",
  "BACKEND_HOST_PORT",
];
const logLevels = new Set(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

function stop(errors) {
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
}

function parseArguments() {
  const args = process.argv.slice(2);
  let example = false;
  let envFile;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--example") {
      example = true;
      continue;
    }
    if (argument === "--env-file") {
      const value = args[index + 1];
      if (!value) throw new Error("--env-file requires a path");
      envFile = resolve(process.cwd(), value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  const defaultFile = fileURLToPath(new URL(
    example ? "../.env.production.example" : "../.env.production",
    import.meta.url,
  ));
  return { example, envFile: envFile ?? defaultFile };
}

function parseEnv(contents) {
  const values = new Map();
  const errors = [];
  for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) {
      errors.push(`line ${index + 1} is not KEY=VALUE`);
      continue;
    }
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      errors.push(`line ${index + 1} has an invalid variable name`);
      continue;
    }
    if (values.has(key)) {
      errors.push(`variable ${key} is duplicated`);
      continue;
    }
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return { values, errors };
}

function integerInRange(value, minimum, maximum) {
  return /^\d+$/.test(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function validateCommon(values, errors) {
  for (const key of requiredKeys) {
    if (!values.has(key)) errors.push(`required variable ${key} is missing`);
  }
  if (values.get("NODE_ENV") !== "production") errors.push("NODE_ENV must be production");
  if (!integerInRange(values.get("PORT") ?? "", 1, 65_535)) {
    errors.push("PORT must be an integer between 1 and 65535");
  }
  if (!integerInRange(values.get("AUTH_SESSION_TTL_HOURS") ?? "", 1, 720)) {
    errors.push("AUTH_SESSION_TTL_HOURS must be an integer between 1 and 720");
  }
  if (!logLevels.has(values.get("LOG_LEVEL"))) errors.push("LOG_LEVEL is invalid");
  for (const key of ["POSTGRES_DB", "POSTGRES_USER"]) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(values.get(key) ?? "")) {
      errors.push(`${key} must be a valid PostgreSQL identifier`);
    }
  }
  if (values.get("BACKEND_BIND_ADDRESS") !== "127.0.0.1") {
    errors.push("BACKEND_BIND_ADDRESS must be 127.0.0.1 for the provided Compose file");
  }
}

function validateProduction(values, errors) {
  for (const key of requiredKeys) {
    if ((values.get(key) ?? "") === "") errors.push(`required variable ${key} is empty`);
  }
  if (!integerInRange(values.get("BACKEND_HOST_PORT") ?? "", 1, 65_535)) {
    errors.push("BACKEND_HOST_PORT must be selected after inventory and be between 1 and 65535");
  }

  const password = values.get("POSTGRES_PASSWORD") ?? "";
  if (password.length < 32 || /\s/.test(password) || password.toLowerCase() === "change-me") {
    errors.push("POSTGRES_PASSWORD must be a strong value of at least 32 non-whitespace characters");
  }

  const encryptionKey = values.get("INTEGRATIONS_ENCRYPTION_KEY") ?? "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encryptionKey) ||
      Buffer.from(encryptionKey, "base64").length !== 32) {
    errors.push("INTEGRATIONS_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }

  let databaseUrl;
  try {
    databaseUrl = new URL(values.get("DATABASE_URL"));
  } catch {
    errors.push("DATABASE_URL must be a valid URL");
  }
  if (databaseUrl) {
    if (!new Set(["postgres:", "postgresql:"]).has(databaseUrl.protocol)) {
      errors.push("DATABASE_URL must use postgres or postgresql");
    }
    if (databaseUrl.hostname !== "backend-postgres" ||
        (databaseUrl.port !== "" && databaseUrl.port !== "5432")) {
      errors.push("DATABASE_URL must target backend-postgres:5432 inside Compose");
    }
    const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
    const databaseUser = decodeURIComponent(databaseUrl.username);
    const databasePassword = decodeURIComponent(databaseUrl.password);
    if (databaseName !== values.get("POSTGRES_DB")) {
      errors.push("DATABASE_URL database must match POSTGRES_DB");
    }
    if (databaseUser !== values.get("POSTGRES_USER")) {
      errors.push("DATABASE_URL user must match POSTGRES_USER");
    }
    if (databasePassword !== password) {
      errors.push("DATABASE_URL password must match POSTGRES_PASSWORD");
    }
  }

  let publicUrl;
  try {
    publicUrl = new URL(values.get("PUBLIC_API_BASE_URL"));
  } catch {
    errors.push("PUBLIC_API_BASE_URL must be a valid URL");
  }
  if (publicUrl && (publicUrl.protocol !== "https:" || publicUrl.username || publicUrl.password ||
      publicUrl.search || publicUrl.hash || publicUrl.pathname !== "/")) {
    errors.push("PUBLIC_API_BASE_URL must be an HTTPS origin without credentials, path, query, or fragment");
  }
  if (publicUrl && publicUrl.origin !== "https://api.pablete.xyz") {
    errors.push("PUBLIC_API_BASE_URL must be https://api.pablete.xyz for this deployment");
  }

  for (const key of values.keys()) {
    if (key.startsWith("BOOTSTRAP_") || key === "BACKEND_TOKEN" || key === "BOT_BACKEND_TOKEN") {
      errors.push(`${key} must not be stored in deploy/.env.production`);
    }
  }
}

function validateExample(values, errors) {
  for (const key of [
    "DATABASE_URL", "INTEGRATIONS_ENCRYPTION_KEY",
    "POSTGRES_PASSWORD", "BACKEND_HOST_PORT",
  ]) {
    if ((values.get(key) ?? "") !== "") errors.push(`${key} must be empty in the example file`);
  }
  if (values.get("PUBLIC_API_BASE_URL") !== "https://api.pablete.xyz") {
    errors.push("PUBLIC_API_BASE_URL must use the planned public API origin in the example file");
  }
}

try {
  const options = parseArguments();
  const contents = await readFile(options.envFile, "utf8");
  const result = parseEnv(contents);
  validateCommon(result.values, result.errors);
  if (options.example) validateExample(result.values, result.errors);
  else validateProduction(result.values, result.errors);

  if (result.errors.length > 0) {
    console.error("Deployment preflight failed:");
    stop(result.errors);
  } else {
    console.log(options.example ? "Deployment env example valid" : "Deployment preflight valid");
  }
} catch (error) {
  console.error(`Deployment preflight failed: ${error.message}`);
  process.exitCode = 1;
}
