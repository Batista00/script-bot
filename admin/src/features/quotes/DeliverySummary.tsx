import type { PhysicalDelivery } from "../../lib/api/types";
export function DeliverySummary({delivery,currency}:{delivery?:PhysicalDelivery|null;currency:string}) {
  if(!delivery)return null;
  return <section><h3>{delivery.method==="pickup"?"Retiro en local":"Despacho a domicilio"}</h3>
    <p>{delivery.address}{delivery.zone?` · ${delivery.zone}`:""}</p>
    <p>Costo de envío: {delivery.fee} {currency}</p><p>{delivery.instructions}</p>
  </section>;
}
