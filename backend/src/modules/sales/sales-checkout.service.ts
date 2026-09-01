import { AppError } from "../../core/errors/app-error.js";
import type { BotGatewayService } from "../bot-gateway/bot-gateway.service.js";
import type { SalesDeliveryService } from "./sales-delivery.service.js";
import type { PostgresSalesRepository } from "./sales.repository.js";
import type { SalesReply, SalesSession } from "./sales.types.js";
import { formatMoney, normalizeText } from "./sales-catalog.js";

export class SalesCheckoutService {
  constructor(private readonly repository: PostgresSalesRepository, private readonly gateway: BotGatewayService,
    private readonly delivery: SalesDeliveryService) {}

  async quote(session: SalesSession): Promise<SalesReply> {
    const {product,quantity,input={}}=session.state;
    if (!product || !quantity) throw new AppError("Selecciona producto y cantidad",400,"SALES_SELECTION_REQUIRED");
    const delivery = await this.delivery.validate(session.businessId,product.productId,quantity,input);
    const quote = await this.gateway.createQuote(session.businessId,{productId:product.productId,quantity,customerId:session.customerId});
    const checkout = await this.repository.createCheckout(session,quote.quoteId,delivery);
    session.state.checkoutId=checkout.id;
    session.state.phase="confirm";
    return {text:`Resumen de tu compra:\nServicio: ${quote.productName}\nCantidad: ${quote.quantity}\nTotal: ${formatMoney(quote.totalPrice,quote.currency)}\n`+
      Object.entries(input).map(([key,value])=>`${product.requiredInputs.find(f=>f.key===key)?.label ?? key}: ${value}`).join("\n")+
      "\nConfírmame si los datos están correctos, o escribe CANCELAR para volver al catálogo."};
  }
  async confirm(session: SalesSession): Promise<SalesReply> {
    const checkout = await this.ownedCheckout(session);
    await this.delivery.revalidate(session.businessId,session.state.quantity!,checkout.delivery);
    // A crash after OrdersService committed is recovered by its unique quote identity.
    const existingId = checkout.orderId ?? await this.repository.orderForQuote(session.businessId,checkout.quoteId);
    const order = existingId ? await this.gateway.getOrder(session.businessId,existingId)
      : await this.gateway.createOrder(session.businessId,{quoteId:checkout.quoteId,customerId:session.customerId});
    if (order.customerId!==session.customerId) throw new AppError("Pedido no encontrado",404,"ORDER_NOT_FOUND");
    await this.repository.linkOrder(checkout,order.orderId);
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
    const method=methods.find(m=>m.paymentMethodId===id) ?? methods.find((candidate)=>{
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
    const names:Record<string,string>={pending_payment:"pendiente de pago",paid:"pago confirmado; pendiente de preparación",
      processing:"en proceso de entrega",completed:"entregado",failed:"requiere revisión humana",cancelled:"cancelado"};
    return {text:`Pedido ${order.orderId}: ${names[order.status] ?? order.status}.`};
  }
  async ownedCheckout(session: SalesSession) {
    if (!session.state.checkoutId) throw new AppError("No hay una compra seleccionada",409,"SALES_CHECKOUT_REQUIRED");
    const checkout=await this.repository.checkout(session.businessId,session.state.checkoutId);
    if (checkout.sessionId!==session.id) throw new AppError("Compra no encontrada",404,"SALES_CHECKOUT_NOT_FOUND");
    return checkout;
  }
}
