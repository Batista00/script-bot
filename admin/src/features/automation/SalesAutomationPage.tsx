import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent } from "react";
import { Button, Field, PageHeader, TextAreaField } from "../../components/ui";
import { apiRequest, errorMessage } from "../../lib/api/client";
import { useBusiness } from "../businesses/business-context";

interface Settings {
  enabled:boolean;displayName:string;welcome:string;policies:string;humanContact:string;
  telegramChatId:string;autoDispatch:boolean;evidenceRetentionDays:number;
}
interface Overview {
  settings:Settings;
  reviewers:{telegramUserId:string;userId:string}[];
  sessions:{id:string;contact:string;paused:boolean}[];
  checkouts:{id:string;orderId:string;mode:string;status:string|null;attentionCode:string|null}[];
  reviews:{id:string;paymentId:string;status:string}[];
  failures:{id:string;channel:string;attempts:number}[];
  inboxFailures:{id:string;contact:string;attempts:number}[];
}
export function SalesAutomationPage() {
  const business=useBusiness(); const client=useQueryClient();
  const path=`/businesses/${business.id}/sales-automation`;
  const queryKey=["sales-automation",business.id];
  const permitted=business.role!=="operator";
  const query=useQuery({queryKey,queryFn:()=>apiRequest<Overview>(path),enabled:permitted});
  const mutation=useMutation({mutationFn:({suffix="",method="POST",body}:{suffix?:string;method?:string;body:unknown})=>apiRequest(path+suffix,{method,body}),
    onSuccess:()=>client.invalidateQueries({queryKey})});
  function configure(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form=new FormData(event.currentTarget);
    const settings:Settings={enabled:form.has("enabled"),autoDispatch:form.has("autoDispatch"),
      displayName:String(form.get("displayName")),welcome:String(form.get("welcome")),policies:String(form.get("policies")),
      humanContact:String(form.get("humanContact")),telegramChatId:String(form.get("telegramChatId")),evidenceRetentionDays:Number(form.get("evidenceRetentionDays"))};
    if (settings.autoDispatch && !query.data?.settings.autoDispatch && !window.confirm("¿Habilitar compras automáticas al proveedor después de pagos confirmados? Esto puede consumir saldo real cuando actives los workflows.")) return;
    mutation.mutate({method:"PUT",body:settings});
  }
  if (!permitted) return <div className="alert">Solo owner y admin pueden configurar ventas y revisores.</div>;
  return <><PageHeader title="Bot y automatizaciones" description="Configuración por negocio. La IA asesora; el backend controla pagos y entrega." />
    {(query.isError || mutation.isError) && <div className="alert error">{errorMessage(query.error ?? mutation.error)}</div>}
    {query.data && <>
      <section className="form-card"><form key={`${business.id}:${query.dataUpdatedAt}`} onSubmit={configure}>
        <h2>Atención y venta</h2>
        <Field label="Nombre del asistente" name="displayName" defaultValue={query.data.settings.displayName} required maxLength={120} />
        <TextAreaField label="Bienvenida" name="welcome" defaultValue={query.data.settings.welcome} required maxLength={500} />
        <TextAreaField label="Políticas, preguntas frecuentes y manejo de objeciones" name="policies" defaultValue={query.data.settings.policies} maxLength={8000} />
        <Field label="Contacto para atención humana" name="humanContact" defaultValue={query.data.settings.humanContact} maxLength={500} />
        <Field label="Chat ID de Telegram (no es el ID del revisor)" name="telegramChatId" defaultValue={query.data.settings.telegramChatId} />
        <Field label="Conservar comprobantes (días)" type="number" name="evidenceRetentionDays" min={2} max={90} defaultValue={query.data.settings.evidenceRetentionDays} />
        <Field label="Habilitar recepción de ventas" type="checkbox" name="enabled" defaultChecked={query.data.settings.enabled} />
        <Field label="Despachar automáticamente al proveedor tras el pago" type="checkbox" name="autoDispatch" defaultChecked={query.data.settings.autoDispatch} />
        <Button type="submit" disabled={mutation.isPending}>Guardar configuración</Button>
      </form></section>
      <section className="form-card"><h2>Revisores de transferencia</h2>
        <p>Vincula tu ID numérico de usuario de Telegram a tu cuenta actual. El sistema comprobará tu rol cada vez que apruebes.</p>
        <form onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);mutation.mutate({suffix:"/reviewers",body:{telegramUserId:String(form.get("telegramUserId"))}});}}>
          <Field label="Mi ID de usuario en Telegram" name="telegramUserId" pattern="[0-9]{1,20}" required />
          <Button disabled={mutation.isPending}>Vincular mi cuenta</Button>
        </form>
        {query.data.reviewers.map(reviewer=><p key={reviewer.telegramUserId}>{reviewer.telegramUserId} <Button className="secondary" disabled={mutation.isPending}
          onClick={()=>mutation.mutate({suffix:"/reviewers",method:"DELETE",body:{telegramUserId:reviewer.telegramUserId}})}>Revocar</Button></p>)}
      </section>
      <section className="form-card"><h2>Conversaciones recientes</h2>{query.data.sessions.map(session=><p key={session.id}>
        {session.contact} — {session.paused ? "Atención humana" : "Bot activo"} <Button className="secondary" disabled={mutation.isPending}
          onClick={()=>mutation.mutate({suffix:`/sessions/${session.id}`,method:"PATCH",body:{paused:!session.paused}})}>{session.paused ? "Reanudar bot" : "Pausar bot"}</Button>
      </p>)}</section>
      <section className="form-card"><h2>Entregas y alertas</h2>{query.data.checkouts.map(checkout=><p key={checkout.id}>
        Pedido {checkout.orderId} — {checkout.status ?? "Pendiente de seguimiento"} {checkout.attentionCode && `— ${checkout.attentionCode}`}
        {checkout.mode==="manual" && checkout.status==="paid" && <Button className="secondary" disabled={mutation.isPending} onClick={()=>{
          const note=window.prompt("Confirma que entregaste el producto e indica la referencia de entrega:");
          if (note?.trim()) mutation.mutate({suffix:`/checkouts/${checkout.id}/complete`,body:{note}});
        }}>Registrar entrega realizada</Button>}
      </p>)}
        {query.data.failures.map(failure=><p className="alert error" key={failure.id}>Notificación {failure.channel} agotó {failure.attempts} intentos. ID {failure.id} <Button disabled={mutation.isPending} onClick={()=>{
          if (window.confirm("¿Reintentar la notificación? Comprueba si ya llegó: un fallo después del envío puede duplicar el mensaje.")) mutation.mutate({suffix:"/jobs/retry",body:{kind:"notifications",id:failure.id}});
        }}>Reintentar notificación</Button></p>)}
        {query.data.inboxFailures.map(failure=><p className="alert error" key={failure.id}>Mensaje de {failure.contact} bloqueado tras {failure.attempts} intentos. Corrige la conexión y después <Button disabled={mutation.isPending}
          onClick={()=>mutation.mutate({suffix:"/jobs/retry",body:{kind:"inbox",id:failure.id}})}>Reprocesar mensaje</Button></p>)}
        <h3>Comprobantes en revisión</h3>{query.data.reviews.map(review=><p key={review.id}>{review.id} — {review.status}</p>)}
      </section>
      <section className="form-card"><h2>Flujos importables</h2><p>Los archivos versionados están en <code>flows/typebot</code> y <code>flows/n8n</code>, junto con <code>flows/CONFIGURACION.md</code>. No contienen credenciales y se importan desactivados.</p>
        <p>Configura primero las integraciones cifradas <code>telegram</code> y <code>automation_runner</code>. Importar los JSON no habilita por sí solo pagos ni compras externas.</p></section>
    </>}
  </>;
}
