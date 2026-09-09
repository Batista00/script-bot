import type { FastifySchema } from "fastify";
import { additionalItemsHttpSchema,quoteItemsHttpSchema } from "../quotes/quote-cart.js";
import { deliverySelectionHttpSchema, physicalDeliveryHttpSchema } from "../products/physical-delivery.js";
import { productDeliveryHttpSchema } from "../products/product-delivery.js";

const uuid = { type: "string", format: "uuid" } as const;
const nullableUuid = { type: ["string", "null"], format: "uuid" } as const;
const nullableString = { type: ["string", "null"] } as const;
const nullableInteger = { type: ["integer", "null"] } as const;
const nullableDate = { type: ["string", "null"], format: "date-time" } as const;
const error = {
  type: "object", additionalProperties: false, required: ["error"],
  properties: {
    error: {
      type: "object", additionalProperties: false, required: ["code", "message"],
      properties: { code: { type: "string" }, message: { type: "string" } },
    },
  },
} as const;
const errors = {
  400: error, 401: error, 404: error, 409: error, 502: error, 503: error,
} as const;
const pagination = {
  type: "object", additionalProperties: false,
  properties: {
    limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
    offset: { type: "string", pattern: "^(?:0|[1-9][0-9]{0,5})$" },
  },
} as const;
const productParams = {
  type: "object", additionalProperties: false, required: ["productId"],
  properties: { productId: uuid },
} as const;
const orderParams = {
  type: "object", additionalProperties: false, required: ["orderId"],
  properties: { orderId: uuid },
} as const;
const paymentParams = {
  type: "object", additionalProperties: false, required: ["paymentId"],
  properties: { paymentId: uuid },
} as const;
const fulfillmentParams = {
  type: "object", additionalProperties: false, required: ["fulfillmentId"],
  properties: { fulfillmentId: uuid },
} as const;

const customer = {
  type: "object", additionalProperties: false,
  required: ["customerId", "name", "phone", "email", "status"],
  properties: {
    customerId: uuid, name: nullableString, phone: nullableString, email: nullableString,
    status: { type: "string", enum: ["active", "inactive"] },
  },
} as const;
const category = {
  type: "object", additionalProperties: false, required: ["categoryId", "name"],
  properties: { categoryId: uuid, name: { type: "string" } },
} as const;
const product = {
  type: "object", additionalProperties: false,
  required: [
    "productId", "categoryId", "name", "description", "type", "sku",
    "minQuantity", "maxQuantity", "requiredInputs",
  ],
  properties: {
    productId: uuid, categoryId: nullableUuid, name: { type: "string" },
    description: nullableString, type: { type: "string", enum: ["service", "product"] },
    sku: nullableString, minQuantity: nullableInteger, maxQuantity: nullableInteger,
    deliveryConfig: productDeliveryHttpSchema,
    requiredInputs: {
      type: "array", maxItems: 20,
      items: {
        type: "object", additionalProperties: false,
        required: ["key", "label", "helpText", "type", "required", "position", "validation"],
        properties: {
          key: { type: "string" }, label: { type: "string" }, helpText: nullableString,
          type: { type: "string", enum: ["url", "text", "textarea", "integer", "date"] },
          required: { type: "boolean" }, position: { type: "integer" },
          validation: { type: "object", additionalProperties: true },
        },
      },
    },
  },
} as const;
const price = {
  type: "object", additionalProperties: false,
  required: [
    "priceId", "productId", "pricingType", "currency", "fixedPrice", "unitPrice",
    "minQuantity", "maxQuantity",
  ],
  properties: {
    priceId: uuid, productId: uuid,
    pricingType: { type: "string", enum: ["fixed", "unit"] },
    currency: { type: "string" }, fixedPrice: nullableInteger, unitPrice: nullableInteger,
    minQuantity: nullableInteger, maxQuantity: nullableInteger,
  },
} as const;
const quote = {
  type: "object", additionalProperties: false,
  required: [
    "quoteId", "customerId", "productId", "productName", "quantity", "currency",
    "unitPrice", "totalPrice", "status", "expiresAt",
  ],
  properties: {
    quoteId: uuid, customerId: nullableUuid, productId: uuid,
    delivery:physicalDeliveryHttpSchema,
    items:quoteItemsHttpSchema,
    productName: { type: "string" }, quantity: { type: "integer" },
    currency: { type: "string" }, unitPrice: nullableInteger,
    totalPrice: { type: "integer" },
    status: { type: "string", enum: ["active", "expired", "converted", "cancelled"] },
    expiresAt: nullableDate,
  },
} as const;
const orderItem = {
  type: "object", additionalProperties: false,
  required: ["orderItemId", "productId", "productName", "quantity", "unitPrice", "totalPrice"],
  properties: {
    orderItemId: uuid, productId: uuid, productName: { type: "string" },
    quantity: { type: "integer" }, unitPrice: nullableInteger, totalPrice: { type: "integer" },
  },
} as const;
const order = {
  type: "object", additionalProperties: false,
  required: ["orderId", "customerId", "quoteId", "status", "currency", "subtotal", "total", "items"],
  properties: {
    orderId: uuid, customerId: uuid, quoteId: uuid,
    delivery:physicalDeliveryHttpSchema,
    status: { type: "string", enum: ["pending_payment", "paid", "processing", "completed", "cancelled", "failed"] },
    currency: { type: "string" }, subtotal: { type: "integer" }, total: { type: "integer" },
    items: { type: "array", items: orderItem },
  },
} as const;
const payment = {
  type: "object", additionalProperties: false,
  required: ["paymentId", "orderId", "status", "providerKey", "checkoutUrl", "expiresAt"],
  properties: {
    paymentId: uuid, orderId: uuid,
    status: { type: "string", enum: ["pending", "approved", "rejected", "cancelled", "expired", "failed"] },
    providerKey: { type: "string" }, checkoutUrl: nullableString, expiresAt: nullableDate,
  },
} as const;
const fulfillment = {
  type: "object", additionalProperties: false,
  required: [
    "fulfillmentId", "orderId", "orderItemId", "productId", "providerOrderReference", "status",
    "submittedAt", "lastStatusSyncedAt", "completedAt",
  ],
  properties: {
    fulfillmentId: uuid, orderId: uuid, orderItemId: uuid, productId: uuid,
    providerOrderReference: nullableString,
    status: { type: "string", enum: [
      "pending", "submitting", "submitted", "in_progress", "completed",
      "partial", "cancelled", "failed", "submission_unknown",
    ] },
    submittedAt: nullableDate, lastStatusSyncedAt: nullableDate, completedAt: nullableDate,
  },
} as const;

export const resolveCustomerSchema = {
  body: {
    type: "object", additionalProperties: false, minProperties: 1,
    properties: {
      name: { type: ["string", "null"], maxLength: 120 },
      phone: { type: ["string", "null"], maxLength: 64 },
      email: { type: ["string", "null"], maxLength: 254 },
    },
  }, response: { 200: customer, ...errors },
} satisfies FastifySchema;

export const listBotCategoriesSchema = {
  querystring: pagination, response: { 200: { type: "array", items: category }, ...errors },
} satisfies FastifySchema;

export const listBotProductsSchema = {
  querystring: {
    ...pagination,
    properties: {
      ...pagination.properties, categoryId: uuid,
      type: { type: "string", enum: ["service", "product"] },
    },
  },
  response: { 200: { type: "array", items: product }, ...errors },
} satisfies FastifySchema;

const catalogPackage = {
  type: "object",
  additionalProperties: false,
  required: ["productId", "name", "quantity", "currency", "price"],
  properties: {
    productId: uuid,
    name: { type: "string" },
    quantity: { type: "integer", minimum: 1 },
    currency: { type: "string" },
    price: { type: "integer", minimum: 1 },
  },
} as const;

export const listBotCatalogPackagesSchema = {
  querystring: {
    type: "object",
    additionalProperties: false,
    required: ["categoryId"],
    properties: { categoryId: uuid },
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["categoryId", "packages"],
      properties: {
        categoryId: uuid,
        packages: {
          type: "array",
          items: catalogPackage,
        },
      },
    },
    ...errors,
  },
} satisfies FastifySchema;

export const getBotProductSchema = {
  params: productParams, response: { 200: product, ...errors },
} satisfies FastifySchema;
export const listBotPricesSchema = {
  params: productParams, querystring: pagination,
  response: { 200: { type: "array", items: price }, ...errors },
} satisfies FastifySchema;

export const createBotQuoteSchema = {
  body: {
    type: "object", additionalProperties: false,
    required: ["productId", "quantity"],
    properties: {
      productId: uuid, quantity: { type: "integer", minimum: 1, maximum: 2_147_483_647 },
      currency: { type: "string", minLength: 3, maxLength: 3 },
      customerId: nullableUuid, expiresAt: nullableDate,
      delivery:deliverySelectionHttpSchema,
      additionalItems:additionalItemsHttpSchema,
    },
  }, response: { 201: quote, ...errors },
} satisfies FastifySchema;

export const createBotOrderSchema = {
  body: {
    type: "object", additionalProperties: false, required: ["quoteId"],
    properties: { quoteId: uuid, customerId: nullableUuid },
  }, response: { 201: order, ...errors },
} satisfies FastifySchema;
export const getBotOrderSchema = {
  params: orderParams, response: { 200: order, ...errors },
} satisfies FastifySchema;

export const createBotPaymentSchema = {
  params: orderParams,
  headers: {
    type: "object", additionalProperties: true,
    properties: { "idempotency-key": { type: "string", minLength: 1, maxLength: 128 } },
  },
  body: {
    type: "object", additionalProperties: false, minProperties: 1,
    properties: {
      providerKey: { type: "string", minLength: 1, maxLength: 64 },
      paymentMethodId: uuid,
    },
  }, response: { 200: payment, 201: payment, ...errors },
} satisfies FastifySchema;
export const listBotPaymentMethodsSchema = {
  response: { 200: { type: "array", items: {
    type: "object", additionalProperties: false,
    required: ["paymentMethodId", "type", "name", "config"],
    properties: { paymentMethodId: uuid, type: { type: "string", enum: ["mercado_pago", "bank_transfer"] }, name: { type: "string" }, config: { type: "object", additionalProperties: true } },
  } }, ...errors },
} satisfies FastifySchema;
export const getBotPaymentSchema = {
  params: paymentParams, response: { 200: payment, ...errors },
} satisfies FastifySchema;

export const dispatchBotFulfillmentSchema = {
  params: orderParams,
  body: {
    type: "object", additionalProperties: false, required: ["orderItemId", "input"],
    properties: {
      orderItemId: uuid,
      input: { type: "object", additionalProperties: true, maxProperties: 50 },
    },
  }, response: { 201: fulfillment, ...errors },
} satisfies FastifySchema;
export const listBotFulfillmentsSchema = {
  params: orderParams,
  response: { 200: { type: "array", items: fulfillment }, ...errors },
} satisfies FastifySchema;
export const getBotFulfillmentSchema = {
  params: fulfillmentParams, response: { 200: fulfillment, ...errors },
} satisfies FastifySchema;
export const syncBotFulfillmentSchema = {
  params: fulfillmentParams, response: { 200: fulfillment, ...errors },
} satisfies FastifySchema;
