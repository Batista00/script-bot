import { AppError } from "../../core/errors/app-error.js";
import type { JsonObject, JsonValue } from "../integrations/integrations.types.js";

const forbiddenKeyPattern = /^(?:key|action|service|quantity|provider_?key|provider_?service_?id|integration_?id|external_?service_?id)$|(?:secret|token|password|credential|authorization|api_?key|access_?token|private_?key)/i;

function invalidInput(): never {
  throw new AppError("Invalid fulfillment input", 400, "FULFILLMENT_INPUT_INVALID");
}

function validateValue(value: unknown, depth: number): asserts value is JsonValue {
  if (depth > 5) invalidInput();
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (value.length > 10_000) invalidInput();
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalidInput();
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) invalidInput();
    for (const item of value) validateValue(item, depth + 1);
    return;
  }
  if (typeof value !== "object" || value === null) invalidInput();
  const entries = Object.entries(value);
  if (entries.length > 50) invalidInput();
  for (const [key, nested] of entries) {
    if (key.length === 0 || key.length > 100 || forbiddenKeyPattern.test(key)) invalidInput();
    validateValue(nested, depth + 1);
  }
}

export function validateFulfillmentInput(value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalidInput();
  validateValue(value, 0);
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 32_768) invalidInput();
  return structuredClone(value as JsonObject);
}
