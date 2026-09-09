import { useState } from "react";
import { Field, SelectField } from "../../components/ui";
import type { ProductDelivery } from "../../lib/api/types";

export function DeliverySelectionFields({config}:{config:ProductDelivery}) {
  const [method,setMethod]=useState(config.methods.includes("pickup")?"pickup":"shipping");
  const [address,setAddress]=useState(""),[zone,setZone]=useState("");
  const selection={method,...(method==="shipping"?{address,...(config.shipping?.mode==="zones"?{zone}:{})}:{})};
  return <fieldset><legend>Entrega del pedido</legend>
    <input type="hidden" name="delivery" value={JSON.stringify(selection)} />
    <SelectField label="Modalidad" value={method} onChange={e=>setMethod(e.target.value)}>
      {config.methods.filter(m=>m==="shipping"||m==="pickup").map(m=><option key={m} value={m}>{m==="pickup"?"Retiro en local":"Domicilio"}</option>)}
    </SelectField>
    {method==="pickup"?<p>{config.pickupAddress||"Falta configurar la dirección del local. No se podrá cotizar."}</p>:<>
      <Field label="Dirección completa" required minLength={8} maxLength={500} value={address} onChange={e=>setAddress(e.target.value)} />
      {config.shipping?.mode==="zones"&&<SelectField label="Zona de despacho" required value={zone} onChange={e=>setZone(e.target.value)}>
        <option value="">Seleccione una zona</option>{config.shipping.zones.map(z=><option key={z.name} value={z.name}>{z.name} — {z.fee}</option>)}
      </SelectField>}
      {(!config.shipping||config.shipping.mode==="quote")&&<p className="alert">El envío requiere una cotización del equipo; no se permite cobrar sin un costo confirmado.</p>}
    </>}
    <p>{config.instructions}</p>
  </fieldset>;
}
