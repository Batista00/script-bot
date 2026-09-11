import { useState } from "react";
import { Button, Field, SelectField, TextAreaField } from "../../components/ui";
import type { ProductDelivery } from "../../lib/api/types";

/** Shared by manual creation, editing and provider import. The submitted value is API-validated. */
export function ProductDeliveryFields({value}: {value?: ProductDelivery | null}) {
  const [kind,setKind]=useState<ProductDelivery["kind"]|"legacy">(value?.kind??"legacy");
  const [methods,setMethods]=useState(value?.methods??["pickup"]);
  const [processing,setProcessing]=useState(value?.processing??"manual");
  const [digitalContents,setDigitalContents]=useState(value?.digitalContents??"downloads");
  const [instructions,setInstructions]=useState(value?.instructions??"");
  const [shippingMode,setShippingMode]=useState(value?.shipping?.mode??"quote");
  const [fee,setFee]=useState(String(value?.shipping?.mode==="fixed"?value.shipping.fee:0));
  const [zones,setZones]=useState(value?.shipping?.mode==="zones"?value.shipping.zones:[{name:"",fee:0}]);
  const [pickupAddress,setPickupAddress]=useState(value?.pickupAddress??"");
  const effectiveMethods=kind==="physical"?methods:[kind];
  const shipping=shippingMode==="fixed"?{mode:"fixed",fee:Number(fee)}:shippingMode==="zones"?{mode:"zones",zones}:{mode:"quote"};
  const config=kind==="legacy"?null:{kind,methods:effectiveMethods,processing:kind==="physical"?"manual":processing,instructions,
    ...(kind==="digital"?{digitalContents}:{}),
    ...(kind==="physical"&&methods.includes("shipping")?{shipping}:{}),
    ...(kind==="physical"&&methods.includes("pickup")&&pickupAddress.trim()?{pickupAddress}:{}),
  };
  function toggle(method:"shipping"|"pickup",checked:boolean){
    setMethods(previous=>checked?[...previous.filter(m=>m!==method),method]:previous.filter(m=>m!==method));
  }
  return <fieldset><legend>Producto y entrega (opcional)</legend>
    <input type="hidden" name="deliveryConfig" value={JSON.stringify(config)} />
    <SelectField label="Naturaleza de la oferta" value={kind} onChange={e=>{
      const next=e.target.value as typeof kind;setKind(next);
      if(next==="physical")setMethods(["pickup"]);
    }}>
      <option value="legacy">Conservar funcionamiento existente</option>
      <option value="service">Servicio (incluye SMM)</option>
      <option value="digital">Producto digital (archivo, enlace o licencia)</option>
      <option value="physical">Producto físico (comida, artículos, etc.)</option>
    </SelectField>
    {kind!=="legacy"&&<>
      {kind==="physical"?<>
        <p>El cliente podrá elegir entre las modalidades habilitadas. Preparación gestionada por el equipo.</p>
        <label><input type="checkbox" checked={methods.includes("shipping")} onChange={e=>toggle("shipping",e.target.checked)} /> Envío a domicilio</label>
        <label><input type="checkbox" checked={methods.includes("pickup")} onChange={e=>toggle("pickup",e.target.checked)} /> Retiro en local</label>
        {!methods.length&&<div className="alert error">Seleccione al menos una modalidad.</div>}
        {methods.includes("pickup")&&<Field label="Dirección del local para retiro" value={pickupAddress} onChange={e=>setPickupAddress(e.target.value)} maxLength={500} />}
        {methods.includes("shipping")&&<>
          <SelectField label="Costo de envío" value={shippingMode} onChange={e=>setShippingMode(e.target.value as typeof shippingMode)}>
            <option value="quote">Cotizar con el equipo antes de pagar</option><option value="fixed">Tarifa fija</option><option value="zones">Tarifa por zona</option>
          </SelectField>
          <p>Importes en la unidad mínima de la moneda del negocio (en CLP, pesos). Cero indica envío gratuito.</p>
          {shippingMode==="fixed"&&<Field label="Tarifa fija de envío" type="number" min="0" step="1" required value={fee} onChange={e=>setFee(e.target.value)} />}
          {shippingMode==="zones"&&<>
            {zones.map((zone,index)=><div className="filter-bar" key={index}>
              <Field label={`Zona ${index+1}`} required maxLength={120} value={zone.name} onChange={e=>setZones(rows=>rows.map((row,i)=>i===index?{...row,name:e.target.value}:row))} />
              <Field label={`Tarifa zona ${index+1}`} required type="number" min="0" step="1" value={zone.fee} onChange={e=>setZones(rows=>rows.map((row,i)=>i===index?{...row,fee:Number(e.target.value)}:row))} />
              <Button type="button" className="secondary" disabled={zones.length===1} onClick={()=>setZones(rows=>rows.filter((_,i)=>i!==index))}>Quitar zona</Button>
            </div>)}
            <Button type="button" className="secondary" disabled={zones.length>=50} onClick={()=>setZones(rows=>[...rows,{name:"",fee:0}])}>Añadir zona</Button>
          </>}
        </>}
        <p>El backend suma la tarifa al total antes del pago. Las entregas por cotizar requieren atención del equipo. La preparación y entrega física no se marcan completas automáticamente.</p>
      </>:<>
        <SelectField label="Procesamiento tras el pago verificado" value={processing} onChange={e=>setProcessing(e.target.value as typeof processing)}>
          <option value="manual">Gestionado por el equipo</option><option value="automatic">Automático mediante integración configurada</option>
        </SelectField>
        {kind==="digital"&&<SelectField label="Contenido digital a entregar" value={digitalContents} onChange={e=>setDigitalContents(e.target.value as typeof digitalContents)}>
          <option value="downloads">Archivos o enlaces de descarga</option><option value="licenses">Una licencia por unidad</option><option value="both">Descargas y licencias</option>
        </SelectField>}
        <p>Automático no significa entrega instantánea. Guarde el producto y vuelva a Editar para cargar enlaces y licencias en Contenido digital privado. Nunca los escriba en la descripción o las condiciones.</p>
      </>}
      <TextAreaField label="Condiciones, horarios y plazos de entrega" maxLength={2000} value={instructions} onChange={e=>setInstructions(e.target.value)} />
    </>}
  </fieldset>;
}
