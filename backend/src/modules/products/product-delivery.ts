import { z } from "zod";
import { AppError } from "../../core/errors/app-error.js";

const fee = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const shippingSchema = z.discriminatedUnion("mode", [
  z.object({mode:z.literal("fixed"),fee}).strict(),
  z.object({mode:z.literal("zones"),zones:z.array(z.object({name:z.string().trim().min(1).max(120),fee}).strict()).min(1).max(50)}).strict(),
  z.object({mode:z.literal("quote")}).strict(),
]);

/** Commercial configuration only; provider credentials and digital assets never belong here. */
export const productDeliverySchema = z.object({
  kind: z.enum(["service", "digital", "physical"]),
  methods: z.array(z.enum(["service", "digital", "shipping", "pickup"])).min(1).max(2),
  processing: z.enum(["manual", "automatic"]),
  instructions: z.string().trim().max(2000).default(""),
  shipping: shippingSchema.optional(),
  pickupAddress: z.string().trim().min(1).max(500).optional(),
  digitalContents:z.enum(["downloads","licenses","both"]).optional(),
}).strict().superRefine((value, ctx) => {
  if(value.digitalContents&&value.kind!=="digital")ctx.addIssue({code:"custom",message:"Digital contents require a digital product"});
  const allowed: string[] = value.kind === "physical" ? ["shipping", "pickup"] : [value.kind];
  if (new Set(value.methods).size !== value.methods.length || value.methods.some(m => !allowed.includes(m))) {
    ctx.addIssue({ code: "custom", message: "Delivery methods do not match the product kind" });
  }
  if (value.kind === "physical" && value.processing === "automatic") {
    ctx.addIssue({ code: "custom", message: "Physical delivery requires preparation by the team" });
  }
  if (value.shipping && !value.methods.includes("shipping")) ctx.addIssue({code:"custom",message:"Shipping requires home delivery"});
  if (value.pickupAddress && !value.methods.includes("pickup")) ctx.addIssue({code:"custom",message:"Pickup address requires store pickup"});
  if (value.shipping?.mode === "zones") {
    const names=value.shipping.zones.map(z=>z.name.toLocaleLowerCase("es"));
    if(new Set(names).size!==names.length)ctx.addIssue({code:"custom",message:"Duplicate shipping zone"});
  }
});
export type ProductDelivery = z.infer<typeof productDeliverySchema>;

export function normalizeProductDelivery(value: unknown, type: "service" | "product"): ProductDelivery | null {
  if (value == null) return null; // Existing products keep their existing fulfillment behavior.
  const result = productDeliverySchema.safeParse(value);
  if (!result.success || (result.data.kind === "service") !== (type === "service")) {
    throw new AppError("Revisa el tipo de producto y sus modalidades de entrega", 400, "INVALID_PRODUCT_DELIVERY");
  }
  return result.data;
}

export const productDeliveryHttpSchema = {
  anyOf: [{ type: "null" }, {
    type: "object", additionalProperties: false, required: ["kind", "methods", "processing"],
    properties: {
      kind: { type: "string", enum: ["service", "digital", "physical"] },
      methods: { type: "array", minItems: 1, maxItems: 2, uniqueItems: true,
        items: { type: "string", enum: ["service", "digital", "shipping", "pickup"] } },
      processing: { type: "string", enum: ["manual", "automatic"] },
      instructions: { type: "string", maxLength: 2000 },
      pickupAddress: {type:"string",minLength:1,maxLength:500},
      digitalContents:{type:"string",enum:["downloads","licenses","both"]},
      shipping: {oneOf:[
        {type:"object",additionalProperties:false,required:["mode","fee"],properties:{mode:{const:"fixed"},fee:{type:"integer",minimum:0,maximum:Number.MAX_SAFE_INTEGER}}},
        {type:"object",additionalProperties:false,required:["mode"],properties:{mode:{const:"quote"}}},
        {type:"object",additionalProperties:false,required:["mode","zones"],properties:{mode:{const:"zones"},zones:{type:"array",minItems:1,maxItems:50,items:{type:"object",additionalProperties:false,required:["name","fee"],properties:{name:{type:"string",minLength:1,maxLength:120},fee:{type:"integer",minimum:0,maximum:Number.MAX_SAFE_INTEGER}}}}}},
      ]},
    },
  }],
} as const;
