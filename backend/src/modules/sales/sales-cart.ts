import { AppError } from "../../core/errors/app-error.js";
import type { SalesSession, CartSelection } from "./sales.types.js";
import type { SalesCheckoutService } from "./sales-checkout.service.js";

export function selectedCartItem(session:SalesSession):CartSelection {
  const {product,quantity,input={},deliverySelection}=session.state;
  if(!product||!quantity)throw new AppError("Seleccione un producto y cantidad",409,"SALES_SELECTION_REQUIRED");
  return {product,quantity,input,...(deliverySelection?{deliverySelection}:{})};
}

export async function addCartItem(session:SalesSession,checkout:SalesCheckoutService) {
  if(!["confirm","payment"].includes(session.state.phase??""))throw new AppError("Complete los datos del producto antes de añadir otro",409,"SALES_STEP_NOT_ALLOWED");
  if((session.state.cart?.length??0)>=9)throw new AppError("El carrito admite hasta 10 productos. Solicite ventas para una compra mayor",409,"CART_LIMIT");
  await checkout.releaseForNewPurchase(session);
  const cart=[...(session.state.cart??[]),selectedCartItem(session)];
  const {checkoutId,greeted}=session.state;
  session.state={cart,phase:"browse",...(checkoutId?{checkoutId}:{}),...(greeted?{greeted}:{}),previousInputs:session.state.input??session.state.previousInputs??{}};
  return {text:"Conservé el producto en el carrito. ¿Qué desea añadir? Antes de pagar le mostraré el resumen completo con un solo total."};
}

export async function removeCartItem(session:SalesSession,productId:string,checkout:SalesCheckoutService) {
  if(!["browse","confirm","payment"].includes(session.state.phase??"browse"))throw new AppError("Complete o cancele la selección actual antes de editar el carrito",409,"SALES_STEP_NOT_ALLOWED");
  const current=session.state.product&&session.state.quantity?selectedCartItem(session):null;
  const all=[...(session.state.cart??[]),...(current?[current]:[])];
  if(!all.some(item=>item.product.productId===productId))throw new AppError("El producto no está en este carrito",404,"CART_PRODUCT_NOT_FOUND");
  await checkout.releaseForNewPurchase(session);
  const remaining=all.filter(item=>item.product.productId!==productId),selected=remaining.pop();
  const {greeted,checkoutId,previousInputs}=session.state;
  session.state={phase:selected?"inputs":"browse",...(greeted?{greeted}:{}),...(checkoutId?{checkoutId}:{}),...(previousInputs?{previousInputs}:{}),
    ...(selected?{product:selected.product,quantity:selected.quantity,input:selected.input,...(selected.deliverySelection?{deliverySelection:selected.deliverySelection}:{})}:{}),cart:remaining};
  return selected?checkout.quote(session):{text:"El carrito quedó vacío. ¿Qué desea comprar?"};
}
