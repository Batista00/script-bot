import type { FastifySchema } from "fastify";

const uuid = { type: "string", format: "uuid" } as const;
const nullableUuid = { anyOf: [uuid, { type: "null" }] } as const;
const nullableString = (maxLength: number) => ({
  anyOf: [{ type: "string", maxLength }, { type: "null" }],
}) as const;
const nullableQuantity = {
  anyOf: [
    { type: "integer", minimum: 1, maximum: 2_147_483_647 },
    { type: "null" },
  ],
} as const;
const requiredInputs = {
  type: "array", maxItems: 20,
  items: {
    type: "object", additionalProperties: false,
    required: ["key", "label", "helpText", "type", "required", "position", "validation"],
    properties: {
      key: { type: "string", pattern: "^[a-z][A-Za-z0-9]{0,63}$" },
      label: { type: "string", minLength: 1, maxLength: 160, pattern: "\\S" },
      helpText: nullableString(1000),
      type: { type: "string", enum: ["url", "text", "textarea", "integer", "date"] },
      required: { type: "boolean" }, position: { type: "integer", minimum: 0, maximum: 19 },
      validation: {
        type: "object", additionalProperties: false,
        properties: {
          minLength: { type: "integer", minimum: 0, maximum: 10000 },
          maxLength: { type: "integer", minimum: 1, maximum: 10000 },
          minimum: { type: "integer", minimum: 0, maximum: 2147483647 },
          maximum: { type: "integer", minimum: 0, maximum: 2147483647 },
        },
      },
    },
  },
} as const;
const error = {
  type: "object", additionalProperties: false, required: ["error"],
  properties: {
    error: {
      type: "object", additionalProperties: false, required: ["code", "message"],
      properties: { code: { type: "string" }, message: { type: "string" } },
    },
  },
} as const;
const product = {
  type: "object", additionalProperties: false,
  required: ["id", "businessId", "categoryId", "name", "description", "type", "sku",
    "minQuantity", "maxQuantity", "requiredInputs", "status", "createdAt", "updatedAt"],
  properties: {
    id: uuid, businessId: uuid, categoryId: nullableUuid, name: { type: "string" },
    description: nullableString(5000), type: { type: "string", enum: ["service", "product"] },
    sku: nullableString(64), minQuantity: nullableQuantity, maxQuantity: nullableQuantity,
    requiredInputs, status: { type: "string", enum: ["active", "inactive"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;
const price = {
  type: "object", additionalProperties: false,
  required: ["id", "businessId", "productId", "pricingType", "currency", "fixedPrice",
    "unitPrice", "minQuantity", "maxQuantity", "status", "createdAt", "updatedAt"],
  properties: {
    id: uuid, businessId: uuid, productId: uuid,
    pricingType: { type: "string", enum: ["fixed", "unit"] },
    currency: { type: "string" }, fixedPrice: { type: ["integer", "null"] },
    unitPrice: { type: ["integer", "null"] }, minQuantity: nullableQuantity,
    maxQuantity: nullableQuantity, status: { type: "string", enum: ["active", "inactive"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;
const mapping = {
  type: "object", additionalProperties: false,
  required: ["id", "businessId", "productId", "providerServiceId", "status", "createdAt", "updatedAt"],
  properties: {
    id: uuid, businessId: uuid, productId: uuid, providerServiceId: uuid,
    status: { type: "string", enum: ["active", "inactive"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

export const importProviderServiceSchema = {
  params: {
    type: "object", additionalProperties: false, required: ["businessId"],
    properties: { businessId: uuid },
  },
  body: {
    type: "object", additionalProperties: false,
    required: ["providerServiceId", "name", "type", "currency", "pricingType", "retailPrice", "status"],
    properties: {
      providerServiceId: uuid,
      name: { type: "string", minLength: 1, maxLength: 160, pattern: "\\S" },
      description: nullableString(5000), categoryId: nullableUuid, sku: nullableString(64),
      type: { type: "string", enum: ["service", "product"] },
      minQuantity: nullableQuantity, maxQuantity: nullableQuantity,
      currency: { type: "string", minLength: 3, maxLength: 3 },
      pricingType: { type: "string", enum: ["fixed", "unit"] },
      retailPrice: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      status: { type: "string", enum: ["active", "inactive"] },
      requiredInputs,
    },
  },
  response: {
    201: {
      type: "object", additionalProperties: false, required: ["product", "price", "mapping"],
      properties: { product, price, mapping },
    },
    400: error, 401: error, 403: error, 404: error, 409: error,
  },
} satisfies FastifySchema;
