import { AppError } from "../../core/errors/app-error.js";
import { quoteSalesCart } from "./sales-cart-checkout.js";
import type { BotGatewayService } from "../bot-gateway/bot-gateway.service.js";
import type { SalesDeliveryService } from "./sales-delivery.service.js";
import type { PostgresSalesRepository } from "./sales.repository.js";
import type { SalesReply, SalesSession } from "./sales.types.js";
import { formatMoney, normalizeText } from "./sales-catalog.js";
import type { PostgresPaymentReviewsRepository } from "../payment-reviews/payment-reviews.repository.js";

export class SalesCheckoutService {
  constructor(private readonly repository: PostgresSalesRepository, private readonly gateway: BotGatewayService,
    private readonly delivery: SalesDeliveryService, private readonly reviews: PostgresPaymentReviewsRepository) {}

  quote(session:SalesSession,manualShipping?:import("../products/physical-delivery.js").ManualShippingQuote):Promise<SalesReply> { return quoteSalesCart(session,this.repository,this.gateway,this.delivery,manualShipping); }
  async confirm(session: SalesSession): Promise<SalesReply> {
    const checkout = await this.ownedCheckout(session);
    await this.delivery.revalidate(session.businessId,session.state.quantity!,checkout.delivery);
    // A crash after OrdersService committed is recovered by its unique quote identity.
    const existingId = checkout.orderId ?? await this.repository.orderForQuote(session.businessId,checkout.quoteId);
    const order = existingId ? await this.gateway.getOrder(session.businessId,existingId)
      : await this.gateway.createOrder(session.businessId,{quoteId:checkout.quoteId,customerId:session.customerId});
    if (order.customerId!==session.customerId) throw new AppError("Pedido no encontrado",404,"ORDER_NOT_FOUND");
    await this.repository.linkOrder(checkout,order.orderId);
    if(checkout.delivery.mode==="digital")await this.delivery.reserveDigital(session.businessId,order.orderId);
    const methods=await this.gateway.listPaymentMethods(session.businessId);
    session.state.phase="payment";
    session.state.paymentChoices=methods.map(m=>m.paymentMethodId);
    return {text:`Pedido ${order.orderId}\nTotal: ${formatMoney(order.total,order.currency)}\n`+
      (methods.length ? "¿Cómo deseas pagar?\n"+methods.map((m,i)=>`${i+1}. ${m.name}`).join("\n")
        :"No hay métodos de pago activos. Solicita atención humana.")};
  }
  async pay(session: SalesSession, selection: string): Promise<SalesReply> {
    const checkout=await this.ownedCheckout(session);
    const methods=await this.gateway.listPaymentMethods(session.businessId);
    const index=/^[1-9][0-9]*$/.test(selection.trim()) ? Number(selection.trim())-1 : -1;
    const id=session.state.paymentChoices?.[index];
    const normalized=normalizeText(selection);
    const method=methods.find(m=>m.paymentMethodId===selection && session.state.paymentChoices?.includes(selection)) ?? methods.find(m=>m.paymentMethodId===id) ?? methods.find((candidate)=>{
      if (candidate.type==="bank_transfer") return /transferencia|banco|cuenta/.test(normalized);
      return /mercado\s*pago|tarjeta|credito|debito/.test(normalized);
    }) ?? methods.find((candidate)=>normalized.includes(normalizeText(candidate.name)));
    if (!method || !checkout.orderId) return {text:"Selecciona el número de uno de los métodos ofrecidos."};
    await this.delivery.revalidate(session.businessId,session.state.quantity!,checkout.delivery);
    const {payment}=await this.gateway.createPayment(session.businessId,checkout.orderId,
      {paymentMethodId:method.paymentMethodId},`sales:${checkout.id}:${method.paymentMethodId}`);
    await this.repository.linkPayment(checkout,payment.paymentId);
    session.state.phase="awaiting";
    if (payment.status!=="pending") return {text:`Pedido ${checkout.orderId}: pago ${payment.status}. Escribe ESTADO para consultar.`};
    if (method.type==="mercado_pago") return {text:payment.checkoutUrl
      ? `Paga tu pedido ${checkout.orderId} en este enlace:\n${payment.checkoutUrl}\nLa aprobación se verificará con Mercado Pago.`
      :"El enlace de pago todavía no está disponible. Solicita atención humana; no generes otro cobro."};
    const labels:Record<string,string>={accountHolder:"Titular",rut:"RUT",bankName:"Banco",accountType:"Tipo de cuenta",accountNumber:"Número de cuenta",email:"Correo"};
    return {text:`Transferencia para pedido ${checkout.orderId}:\n`+Object.entries(method.config).filter(([k])=>labels[k])
      .map(([k,v])=>`${labels[k]}: ${v}`).join("\n")+
      "\nEnvía una imagen JPG o PNG del comprobante. Una persona verificará el abono antes de aprobarlo."};
  }
  async status(session: SalesSession): Promise<SalesReply> {
    if (!session.state.checkoutId) return {text:"Todavía no tienes una compra seleccionada. Escribe CATÁLOGO."};
    const checkout=await this.ownedCheckout(session);
    if (!checkout.orderId) return {text:"La cotización está pendiente de tu confirmación. Escribe CONFIRMAR."};
    const order=await this.gateway.getOrder(session.businessId,checkout.orderId);
    if (order.status==="pending_payment" && checkout.paymentId) {
      const payment=await this.gateway.getPayment(session.businessId,checkout.paymentId);
      if (payment.status==="approved") return {text:`Pedido ${order.orderId}: el pago está confirmado; estamos actualizando el pedido.`};
      const review=await this.reviews.latestStatus(session.businessId,checkout.paymentId,session.id);
      const prefix=`Pedido ${order.orderId}: pendiente de pago. `;
      if (review) {
        const messages:Record<string,string>={
          pending:"Recibimos su comprobante y está pendiente de revisión humana. No necesita enviarlo otra vez; le avisaremos del resultado.",
          approving:"La verificación del abono está en curso. Le avisaremos cuando termine; todavía no confirmamos el pago.",
          rejected:"El comprobante fue rechazado porque no permitió verificar el abono. Puede enviar el comprobante correcto o solicitar un agente de soporte.",
          more_info:"El revisor solicitó más información. Revise monto, destinatario y referencia; envíe un comprobante legible o contacte a soporte.",
          approved:"La revisión fue registrada; estamos comprobando el estado del pago. Todavía no hay confirmación comercial.",
        };
        return {text:prefix+(review.status==="pending" && new Date(review.expiresAt).getTime()<=Date.now()
          ? "La revisión del comprobante venció. Solicite un agente de soporte; el pago no se ha confirmado."
          : messages[review.status])};
      }
      return {text:prefix+(payment.checkoutUrl
        ? `Puede pagar en este enlace:\n${payment.checkoutUrl}\nLe avisaremos cuando el proveedor confirme el pago.`
        : "Todavía no hemos recibido un comprobante para este pago. Si realizó la transferencia, envíe su comprobante o solicite soporte.")};
    }
    const names:Record<string,string>={pending_payment:"pendiente de pago",paid:"pago confirmado; pendiente de preparación",
      processing:"en proceso de entrega",completed:"entregado",failed:"requiere revisión humana",cancelled:"cancelado"};
    const fulfillments=await this.gateway.listFulfillments(session.businessId,order.orderId);
    const submitted=fulfillments.map(item=>item.submittedAt).filter((value):value is string=>Boolean(value)).sort()[0];
    const elapsed=submitted ? Math.max(0,Math.floor((Date.now()-new Date(submitted).getTime())/60000)) : null;
    return {text:`Pedido ${order.orderId}: ${names[order.status] ?? order.status}.`+
      (submitted && elapsed!==null ? `\nEnviado al proveedor: ${submitted}. Tiempo transcurrido: ${elapsed} minutos.`
        :"\nTodavía no hay una fecha de envío al proveedor confirmada.")};
  }
  async ownedCheckout(session: SalesSession) {
    if (!session.state.checkoutId) throw new AppError("No hay una compra seleccionada",409,"SALES_CHECKOUT_REQUIRED");
    const checkout=await this.repository.checkout(session.businessId,session.state.checkoutId);
    if (checkout.sessionId!==session.id) throw new AppError("Compra no encontrada",404,"SALES_CHECKOUT_NOT_FOUND");
    return checkout;
  }
  async releaseForNewPurchase(session:SalesSession):Promise<void> {
    if(!session.state.checkoutId)return;
    const checkout=await this.ownedCheckout(session);
    if(!checkout.orderId)return;
    const order=await this.gateway.getOrder(session.businessId,checkout.orderId);
    if(order.status!=="pending_payment")return; // Paid/processing orders continue independently.
    if(checkout.paymentId){
      const payment=await this.gateway.getPayment(session.businessId,checkout.paymentId);
      const review=await this.reviews.latestStatus(session.businessId,checkout.paymentId,session.id);
      if(payment.status==="approved"||review&&["pending","approving","more_info","approved"].includes(review.status)){
        throw new AppError("Hay un pago o comprobante en revisión. Solicita soporte antes de reemplazar esta compra",409,"SALE_CHANGE_REQUIRES_REVIEW");
      }
      // An issued checkout can still be paid externally. Do not cancel it based on conversation alone.
      throw new AppError("Este pedido ya tiene un medio de pago generado. Un agente debe gestionar el cambio para evitar cobros duplicados",409,"SALE_CHANGE_REQUIRES_REVIEW");
    }
    await this.gateway.cancelUnpaidOrder(session.businessId,checkout.orderId);
  }
}
