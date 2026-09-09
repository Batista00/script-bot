import type { SalesSession, SalesSettings } from "./sales.types.js";
import { catalogTermGroupsFromText, directCatalogTermGroupsFromText, normalizeText } from "./sales-catalog.js";

/** Public business data only. Never include provider costs, credentials or customer IDs. */
export function salesContext(session: SalesSession, settings: SalesSettings) {
  const { state } = session;
  return {
    assistantName: settings.displayName, welcome: settings.welcome, policies: settings.policies,
    humanContact: settings.humanContact, phase: state.phase ?? "browse", greeted: state.greeted === true,
    returningCustomer: Boolean(state.checkoutId), options: state.choiceLabels ?? [],
    catalogListing: null as string|null,
    purchaseSummary:null as string|null,
    selectedProduct: state.product ? {
      productId:state.product.productId,
      name: state.product.name, description: state.product.description,
      quantity: state.quantity ?? null, requirements: state.product.requiredInputs,
      delivery: state.product.deliveryConfig ?? null,
    } : null,
    products:(state.choices??[]).map((p,i)=>({productId:p.productId,name:p.name,description:p.description,
      minQuantity:p.minQuantity,maxQuantity:p.maxQuantity,offeredQuantity:state.choiceQuantities?.[i]??null,
      priceLabel:state.choiceLabels?.[i]??p.name,delivery:p.deliveryConfig??null})),
    suppliedInputs: state.input ?? {}, previousInputs: state.previousInputs ?? {}, paused: session.paused,
    deliverySelection:state.deliverySelection??null,
    cart:(state.cart??[]).map(item=>({productId:item.product.productId,name:item.product.name,description:item.product.description,quantity:item.quantity,inputs:item.input})),
  };
}

export function conversationalIntent(text: string): "support" | "special" | "faq" | "status" | "greeting" | "help" | null {
  const value = normalizeText(text);
  const words=value.replace(/[^\p{L}\p{N}\s]/gu," ").replace(/\s+/g," ").trim();
  if (/^(?:(?:hola|holi|hey|buenas|buenos dias|buen dia|buenas tardes|buenas noches|inicio)(?:\s+|$))+(?:(?:como estas|que tal)(?:\s+|$))?$/.test(words)) return "greeting";
  if (["ayuda","opciones","que puedes hacer","necesito ayuda"].includes(words)) return "help";
  if (/^(?:ventas|hablar con ventas|contactar ventas|atencion de ventas)$/.test(words)) return "support";
  if (/\b(humano|persona|asesor|agente|soporte|reclamo|reposicion|recarga por caida)\b/.test(value) ||
      /no (?:me )?(?:llegaron|llegan|recibi|se cursaron)|(?:pedido|entrega|servicio).*(?:retras|demor)|caida de seguidores/.test(value)) return "support";
  if (/precio especial|cotiza(?:cion|r).*(?:especial|personaliz)|descuento|distribu|repartir|varios perfiles|varias cuentas/.test(value) ||
      (text.match(/https?:\/\/\S+/g)?.length ?? 0) > 1) return "special";
  if (/estado.*(?:pedido|pago|comprobante)|(?:pedido|pago|comprobante).*(?:estado|como va)|^como va|(?:confirmacion|revision|envie|enviado|mande|recibieron).*comprobante|comprobante.*(?:confirm|revis|recib)/.test(value)) return "status";
  if (/como funciona|son (?:reales|bots)|interaccion|riesgo|baneo|garantia|cuanto (?:tarda|demora|dura)|cuanto tiempo|dan likes|daran likes|perfil publico|es seguro|por que.*(?:caen|bajan)|pueden (?:caer|bajar)/.test(value)) return "faq";
  return null;
}

/** Only explicit catalog enquiries; the existing parser still resolves product terms. */
export function catalogInquiryTermGroups(text:string):string[][]|null {
  if(conversationalIntent(text)!==null)return null;
  const words=normalizeText(text).replace(/[^\p{L}\p{N}]+/gu," ").trim().replace(/\s+/g," ");
  const request=words.match(/^(?:hola |por favor )?(?:cuanto (?:salen|sale|cuestan|cuesta|valen|vale)|precios?|quiero comprar|(?:que |cuales )?opciones|muestrame|mostrarme)\b\s*(.*)$/);
  if(!request)return directCatalogTermGroupsFromText(text);
  const search=request[1]!.replace(/^(?:de |del |para )/,"").replace(/\b(?:tienen|disponibles|por favor)\b/g,"").trim();
  if(!search || /^(?:algo|eso|esto|todo|todos|todas|este servicio|ese producto|lo mismo)$/.test(search))return null;
  const groups=catalogTermGroupsFromText(search);
  return groups.length?groups:null;
}
