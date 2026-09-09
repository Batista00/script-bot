import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Field, Modal } from "../../components/ui";
import { apiRequest, errorMessage } from "../../lib/api/client";
import { useBusiness } from "../businesses/business-context";
import type { SalesAdminSession } from "./sales-automation.types";

export function ShippingQuoteModal({session,onClose}:{session:SalesAdminSession;onClose:()=>void}){
  const business=useBusiness(),client=useQueryClient();
  const [requestId]=useState(()=>crypto.randomUUID());
  const [address,setAddress]=useState(session.deliverySelection?.address??""),[fee,setFee]=useState("");
  const mutation=useMutation({mutationFn:()=>apiRequest(`/businesses/${business.id}/sales-automation/sessions/${session.id}/shipping-quote`,{
    method:"POST",body:{requestId,address,fee:Number(fee)},
  }),onSuccess:async()=>{await client.invalidateQueries({queryKey:["sales-automation",business.id]});onClose();}});
  return <Modal title="Cotizar envío antes del pago" onClose={onClose}><form onSubmit={e=>{
    e.preventDefault();if(window.confirm("¿Enviar el resumen con esta tarifa y reanudar el bot para que el cliente confirme? No se cobrará todavía."))mutation.mutate();
  }}>
    <p>Cliente: {session.contact}. Sólo para productos con envío por cotizar. La tarifa se aplica una vez al carrito completo, sin modificar precios de productos.</p>
    <Field label="Dirección confirmada con el cliente" required minLength={8} maxLength={500} value={address} onChange={e=>setAddress(e.target.value)} disabled={mutation.isPending} />
    <Field label={`Costo total de envío (${business.currency}, unidad mínima)`} type="number" min="0" step="1" required value={fee} onChange={e=>setFee(e.target.value)} disabled={mutation.isPending} />
    <p>Su usuario quedará registrado en la cotización. El cliente recibirá el resumen completo por WhatsApp y deberá confirmarlo antes de pagar.</p>
    {mutation.isError&&<div className="alert error">{errorMessage(mutation.error)}</div>}
    <Button type="submit" disabled={mutation.isPending}>Enviar resumen para confirmar</Button>
  </form></Modal>;
}
