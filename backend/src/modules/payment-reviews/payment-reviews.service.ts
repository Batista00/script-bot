import { randomBytes } from "node:crypto";
import { AppError } from "../../core/errors/app-error.js";
import type { IntegrationCredentialsCrypto } from "../integrations/integrations.crypto.js";
import type { PaymentsService } from "../payments/payments.service.js";
import type { PostgresSalesRepository } from "../sales/sales.repository.js";
import type { SalesCheckoutService } from "../sales/sales-checkout.service.js";
import { secretHash } from "../sales/sales-access.service.js";
import type { PostgresNotificationsRepository } from "../automation/notifications.repository.js";
import type { PostgresPaymentReviewsRepository, PaymentReview } from "./payment-reviews.repository.js";
import { describeEvidenceAnalysis, type EvidenceAnalysis } from "./evidence-analysis.js";

export interface EvidenceInput { base64:string; mimeType:"image/jpeg"|"image/png" }
export function validateEvidence(input:EvidenceInput):Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64) || input.base64.length>2_800_000) {
    throw new AppError("Envía una imagen JPG o PNG de hasta 2 MB",400,"INVALID_PAYMENT_EVIDENCE");
  }
  const bytes=Buffer.from(input.base64,"base64");
  const jpeg=bytes.subarray(0,3).equals(Buffer.from([255,216,255]));
  const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (bytes.length>2_097_152 || bytes.length<12 || (input.mimeType==="image/jpeg" ? !jpeg : !png)) {
    throw new AppError("La imagen no tiene el formato o tamaño permitido",400,"INVALID_PAYMENT_EVIDENCE");
  }
  return bytes;
}
export class PaymentReviewsService {
  constructor(private readonly repository:PostgresPaymentReviewsRepository,private readonly sales:PostgresSalesRepository,
    private readonly checkout:SalesCheckoutService,private readonly payments:PaymentsService,
    private readonly crypto:IntegrationCredentialsCrypto,private readonly notifications:PostgresNotificationsRepository) {}

  async submit(businessId:string,sessionId:string,input:EvidenceInput) {
    const bytes=validateEvidence(input);
    return this.sales.exclusive(sessionId,async()=>{
      const settings=await this.sales.settings(businessId);
      if (!settings.enabled || !settings.telegramChatId) throw new AppError("La revisión de transferencias no está configurada",409,"REVIEW_NOT_CONFIGURED");
      const session=await this.sales.session(businessId,sessionId);
      if (session.state.optedOut || session.paused) return {text:"",reviewId:null};
      if(session.state.phase==="inputs"||session.state.phase==="quantity"||!session.state.checkoutId){
        const field=session.state.product?.requiredInputs.find(f=>!(f.key in (session.state.input??{})));
        return {reviewId:null,text:field?.type==="url"
          ? "Para automatizar la compra necesito el enlace escrito del perfil, página o publicación, no una fotografía. Si no puede compartirlo, puedo derivarle a un agente de ventas."
          : `Recibí una imagen. ${field?`Para continuar necesito: ${field.label}. Envíelo escrito.`:"Cuénteme qué necesita."} Si necesita atención especializada, pida un agente de ventas.`};
      }
      const checkout=await this.checkout.ownedCheckout(session);
      if (!checkout.paymentId) throw new AppError("Selecciona transferencia primero",409,"PAYMENT_REQUIRED");
      const payment=await this.payments.getById(businessId,checkout.paymentId);
      if (payment.providerKey!=="bank_transfer" || payment.status!=="pending") {
        throw new AppError("Este pago no admite comprobantes pendientes",409,"PAYMENT_NOT_REVIEWABLE");
      }
      const callback=randomBytes(24).toString("base64url");
      const review=await this.repository.create(businessId,payment.id,sessionId,secretHash(bytes.toString("base64")),
        this.crypto.encrypt({base64:input.base64,mimeType:input.mimeType},businessId,"payment_evidence"),
        secretHash(callback),this.crypto.encrypt({value:callback},businessId,"review_callback"));
      await this.notifications.enqueue(businessId,`review:${review.id}`,"telegram",{
        chatId:settings.telegramChatId,reviewId:review.id,
        text:`TRANSFERENCIA POR REVISAR\nPedido ${payment.orderId}\nEsperado: ${payment.amount} ${payment.currency}\nCliente: ${session.contact}\nLa imagen no prueba el abono. Comprueba tu cuenta bancaria antes de aprobar.`,
      });
      return {reviewId:review.id,text:"Recibimos tu comprobante. Una persona verificará el abono; todavía no está aprobado."};
    });
  }
  async notification(businessId:string,reviewId:string) {
    const review=await this.repository.find(businessId,reviewId);
    if (!review || !review.evidenceEncrypted) throw new AppError("Comprobante no disponible",404,"REVIEW_NOT_FOUND");
    const evidence=this.crypto.decrypt(review.evidenceEncrypted,businessId,"payment_evidence");
    const callback=this.crypto.decrypt(review.callbackEncrypted,businessId,"review_callback").value;
    return {evidence,replyMarkup:{inline_keyboard:[[
      {text:"Verificar y aprobar",callback_data:`approve:${callback}`},
      {text:"Rechazar comprobante",callback_data:`reject:${callback}`},
      {text:"Pedir información",callback_data:`info:${callback}`},
    ]]}};
  }
  async annotate(businessId:string,sessionId:string,reviewId:string,analysis:EvidenceAnalysis) {
    return this.sales.exclusive(`review-analysis:${reviewId}`,async()=>{
      const review=await this.repository.find(businessId,reviewId);
      if (!review || review.sessionId!==sessionId || !review.evidenceEncrypted) throw new AppError("Comprobante no encontrado",404,"REVIEW_NOT_FOUND");
      const original=this.crypto.decrypt(review.evidenceEncrypted,businessId,"payment_evidence");
      const encrypted=this.crypto.encrypt({...original,analysis},businessId,"payment_evidence");
      if (!await this.repository.saveEvidence(businessId,reviewId,encrypted)) throw new AppError("La revisión expiró",409,"REVIEW_EXPIRED");
      const payment=await this.payments.getById(businessId,review.paymentId);
      const settings=await this.sales.settings(businessId);
      await this.notifications.enqueue(businessId,`review-analysis:${review.id}`,"telegram",{
        chatId:settings.telegramChatId,reviewId:review.id,reviewPresentation:"text",
        text:`Pedido ${payment.orderId}\n`+describeEvidenceAnalysis(analysis,payment.amount,payment.currency),
      });
      return {ok:true};
    });
  }
  async authorize(businessId:string,telegramUserId:string,callback:string):Promise<{review:PaymentReview;userId:string}> {
    const userId=await this.repository.authorizedReviewer(businessId,telegramUserId);
    if (!userId) throw new AppError("No tienes permiso de aprobación en este negocio",403,"REVIEWER_NOT_AUTHORIZED");
    const review=await this.repository.byCallback(businessId,secretHash(callback));
    if (!review || new Date(review.expiresAt).getTime()<=Date.now()) throw new AppError("La revisión expiró o no existe",409,"REVIEW_EXPIRED");
    return {review,userId};
  }
  async decide(businessId:string,telegramId:string,callback:string,action:"approve"|"reject"|"info",reference?:string) {
    const initial=await this.authorize(businessId,telegramId,callback);
    return this.sales.exclusive(`review-payment:${initial.review.paymentId}`,async()=>{
      const {review,userId}=await this.authorize(businessId,telegramId,callback);
      if (review.status==="approved" || review.status==="rejected") return {text:"Esta revisión ya fue resuelta."};
      const payment=await this.payments.getById(businessId,review.paymentId);
      if (payment.status!=="pending" && !(payment.status==="approved" && review.status==="approving")) {
        throw new AppError("El pago ya no está pendiente",409,"PAYMENT_NOT_REVIEWABLE");
      }
      if (action==="approve") {
        if (!reference?.trim()) return {text:`Comprueba el abono en el banco y confirma su referencia con:\n/abono ${callback} REFERENCIA_BANCARIA\nNo uses el número del pedido como referencia bancaria.`};
        const normalized=reference.trim();
        if (normalized.length>128 || /[\u0000-\u001f]/.test(normalized)) throw new AppError("Referencia inválida",400,"INVALID_TRANSFER_REFERENCE");
        if (review.status==="approving" && (review.reference!==normalized || review.reviewerId!==userId)) {
          throw new AppError("Otra confirmación está en curso",409,"REVIEW_IN_PROGRESS");
        }
        // Persist intent/actor BEFORE approval. A retry can finish auditing a committed payment.
        await this.repository.decide(review,"approving",userId,normalized);
        try { await this.payments.confirmBankTransfer(businessId,review.paymentId,normalized); }
        catch(error) {
          // A definite rejection (for example a reused bank reference) can be corrected.
          // Ambiguous database failures keep the original intent for safe recovery.
          if (error instanceof AppError && error.statusCode<500 &&
              (await this.payments.getById(businessId,review.paymentId)).status==="pending") {
            await this.repository.decide(review,"pending",userId,null);
          }
          throw error;
        }
        await this.repository.decide(review,"approved",userId,normalized);
        return {text:`Pago aprobado para pedido ${payment.orderId}. Quedó registrada tu verificación humana.`};
      }
      if (review.status==="approving") throw new AppError("Hay una aprobación en curso",409,"REVIEW_IN_PROGRESS");
      await this.repository.decide(review,action==="reject"?"rejected":"more_info",userId,null);
      const session=await this.sales.session(businessId,review.sessionId);
      if (!session.state.optedOut) await this.notifications.enqueue(businessId,`review:${review.id}:${action}`,"whatsapp",{contact:session.contact,
        text:action==="reject" ? `El comprobante de tu pedido ${payment.orderId} fue rechazado: no permitió verificar el abono. Solicita un agente de soporte o envía el comprobante correcto.`
          :`Necesitamos más información de tu transferencia para el pedido ${payment.orderId}. Revisa monto, destinatario y referencia; envía un comprobante legible.`});
      return {text:action==="reject"
        ? "Comprobante rechazado. El pago sigue pendiente; el pedido no fue cancelado. Se notificará al cliente."
        : "Información adicional solicitada. El pago sigue pendiente; se notificará al cliente."};
    });
  }
}
