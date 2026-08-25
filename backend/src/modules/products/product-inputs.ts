import { AppError } from "../../core/errors/app-error.js";
import type { JsonObject } from "../integrations/integrations.types.js";

export const productInputTypes = ["url", "text", "textarea", "integer", "date"] as const;
export type ProductInputType = (typeof productInputTypes)[number];

export interface ProductInputValidation {
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

export interface ProductInputField {
  key: string;
  label: string;
  helpText: string | null;
  type: ProductInputType;
  required: boolean;
  position: number;
  validation: ProductInputValidation;
}

function invalid(): never {
  throw new AppError("Invalid product required inputs", 400, "INVALID_PRODUCT_INPUTS");
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    invalid();
  }
  return value as number;
}

export function normalizeProductInputs(value: unknown): ProductInputField[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) invalid();
  const keys = new Set<string>();
  const positions = new Set<number>();
  return value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) invalid();
    const source = item as Record<string, unknown>;
    const allowed = new Set(["key", "label", "helpText", "type", "required", "position", "validation"]);
    if (Object.keys(source).some((key) => !allowed.has(key))) invalid();
    if (typeof source.key !== "string" || !/^[a-z][A-Za-z0-9]{0,63}$/.test(source.key)) invalid();
    if (keys.has(source.key)) invalid();
    keys.add(source.key);
    if (typeof source.label !== "string") invalid();
    const label = source.label.trim();
    if (label.length === 0 || label.length > 160) invalid();
    const helpText = source.helpText === undefined || source.helpText === null || source.helpText === ""
      ? null
      : typeof source.helpText === "string" ? source.helpText.trim() : invalid();
    if (helpText !== null && (helpText.length === 0 || helpText.length > 1000)) invalid();
    if (typeof source.type !== "string" || !productInputTypes.includes(source.type as ProductInputType)) invalid();
    if (typeof source.required !== "boolean") invalid();
    const position = boundedInteger(source.position, 0, 19);
    if (position === undefined || positions.has(position)) invalid();
    positions.add(position);
    const rawValidation = source.validation ?? {};
    if (typeof rawValidation !== "object" || rawValidation === null || Array.isArray(rawValidation)) invalid();
    const validationSource = rawValidation as Record<string, unknown>;
    const validationKeys = new Set(["minLength", "maxLength", "minimum", "maximum"]);
    if (Object.keys(validationSource).some((key) => !validationKeys.has(key))) invalid();
    const validation: ProductInputValidation = {};
    const minLength = boundedInteger(validationSource.minLength, 0, 10_000);
    const maxLength = boundedInteger(validationSource.maxLength, 1, 10_000);
    const minimum = boundedInteger(validationSource.minimum, 0, 2_147_483_647);
    const maximum = boundedInteger(validationSource.maximum, 0, 2_147_483_647);
    if (minLength !== undefined) validation.minLength = minLength;
    if (maxLength !== undefined) validation.maxLength = maxLength;
    if (minimum !== undefined) validation.minimum = minimum;
    if (maximum !== undefined) validation.maximum = maximum;
    if ((minLength ?? 0) > (maxLength ?? 10_000)) invalid();
    if ((minimum ?? 0) > (maximum ?? 2_147_483_647)) invalid();
    if (source.type === "integer" && (minLength !== undefined || maxLength !== undefined)) invalid();
    if (source.type !== "integer" && (minimum !== undefined || maximum !== undefined)) invalid();
    return {
      key: source.key,
      label,
      helpText,
      type: source.type as ProductInputType,
      required: source.required,
      position,
      validation,
    };
  }).sort((a, b) => a.position - b.position);
}

export function validateCommercialInput(
  schema: readonly ProductInputField[],
  input: JsonObject,
): JsonObject {
  if (schema.length === 0) return input;
  const fields = new Map(schema.map((field) => [field.key, field]));
  if (Object.keys(input).some((key) => !fields.has(key))) invalid();
  for (const field of schema) {
    const value = input[field.key];
    if (value === undefined || value === null || value === "") {
      if (field.required) invalid();
      continue;
    }
    if (field.type === "integer") {
      if (!Number.isSafeInteger(value)) invalid();
      const number = value as number;
      if (number < (field.validation.minimum ?? 0) || number > (field.validation.maximum ?? 2_147_483_647)) invalid();
      continue;
    }
    if (typeof value !== "string") invalid();
    const text = value.trim();
    if (text.length < (field.validation.minLength ?? 1) || text.length > (field.validation.maxLength ?? 10_000)) invalid();
    if (field.type === "url") {
      try {
        const url = new URL(text);
        if (url.protocol !== "http:" && url.protocol !== "https:") invalid();
      } catch {
        invalid();
      }
    }
  }
  return input;
}
