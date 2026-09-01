import { z } from "zod";
import { AppError } from "../../core/errors/app-error.js";
import { evidenceAnalysisSchema } from "../payment-reviews/evidence-analysis.js";

export function validated<T>(schema:z.ZodType<T>,value:unknown):T {
  const result=schema.safeParse(value);
  if (!result.success) throw new AppError("Revisa los campos de la solicitud",400,"INVALID_REQUEST");
  return result.data;
}
export const uuid=z.string().uuid();
export const messageSchema=z.object({messageId:z.string().min(1).max(128),text:z.string().min(1).max(10_000)}).strict();
export const openSessionSchema=z.object({contact:z.string().regex(/^[0-9]{8,15}$/),name:z.string().trim().min(1).max(120).optional()}).strict();
export const settingsSchema=z.object({
  enabled:z.boolean(),displayName:z.string().trim().min(1).max(120),welcome:z.string().trim().min(1).max(500),
  policies:z.string().max(8000),humanContact:z.string().max(500),telegramChatId:z.string().regex(/^-?[0-9]{1,20}$|^$/),
  autoDispatch:z.boolean(),evidenceRetentionDays:z.number().int().min(2).max(90),
}).strict();
export const evidenceSchema=z.object({base64:z.string().max(2_800_000),mimeType:z.enum(["image/jpeg","image/png"])}).strict();
export const telegramSchema=z.object({
  callback_query:z.object({id:z.string().max(256),from:z.object({id:z.number().int().positive()}),data:z.string().max(64).optional(),
    message:z.object({chat:z.object({id:z.number().int()})}).optional()}).optional(),
  message:z.object({from:z.object({id:z.number().int().positive()}).optional(),chat:z.object({id:z.number().int()}),text:z.string().max(4096).optional()}).optional(),
});
export const reviewerSchema=z.object({telegramUserId:z.string().regex(/^[0-9]{1,20}$/)}).strict();
export const ackSchema=z.object({id:uuid,lease:uuid,success:z.boolean()}).strict();
export const pauseSchema=z.object({paused:z.boolean()}).strict();
export const manualSchema=z.object({note:z.string().trim().min(1).max(1000)}).strict();
export const inboxSchema=openSessionSchema.extend({messageId:z.string().min(1).max(128),text:z.string().max(10_000),image:z.boolean()}).strict();
export const inboxAckSchema=z.object({id:uuid,lease:uuid,text:z.string().max(10_000)}).strict();
export const retryJobSchema=z.object({kind:z.enum(["inbox","notifications"]),id:uuid}).strict();
export const analysisSchema=z.object({reviewId:uuid,analysis:evidenceAnalysisSchema}).strict();
