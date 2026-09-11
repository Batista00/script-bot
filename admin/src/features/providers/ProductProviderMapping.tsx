import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { businessQueryKey } from "../../app/query-client";
import { Button, Field, SelectField, Spinner, StatusBadge, useToast } from "../../components/ui";
import { ApiError, errorMessage } from "../../lib/api/client";
import { providerApi } from "../../lib/api/resources";
import type { Product } from "../../lib/api/types";
import { useBusiness } from "../businesses/business-context";

export function ProductProviderMapping({product}:{product:Product}) {
  const business=useBusiness(),client=useQueryClient(),toast=useToast();
  const [search,setSearch]=useState(""),[offset,setOffset]=useState(0),[selected,setSelected]=useState("");
  const query=useQuery({queryKey:businessQueryKey("mapping",business.id,product.id),queryFn:async()=>{
    try{return await providerApi.mapping(business.id,product.id);}
    catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e;}
  },retry:false});
  const current=useQuery({queryKey:businessQueryKey("provider-service",business.id,query.data?.providerServiceId??"none"),
    enabled:!!query.data,queryFn:()=>providerApi.get(business.id,query.data!.providerServiceId)});
  const services=useQuery({queryKey:businessQueryKey("provider-services",business.id,"mapping-options",{search,offset}),
    queryFn:()=>providerApi.list(business.id,{limit:25,offset,providerStatus:"active",...(search.trim()?{search:search.trim()}:{})})});
  const mutation=useMutation({mutationFn:({providerServiceId,status}:{providerServiceId:string;status?:"active"|"inactive"})=>
    query.data?providerApi.updateMapping(business.id,product.id,{providerServiceId,status:status??"active"}):providerApi.createMapping(business.id,product.id,providerServiceId),
    onSuccess:async()=>{await client.invalidateQueries({queryKey:["mapping",business.id,product.id]});setSelected("");toast("Vínculo actualizado. Las órdenes enviadas conservan su referencia original.");}});
  const disabled=business.role==="operator"||mutation.isPending||query.isError||query.isLoading;
  return <article className="mapping-card"><h3>Proveedor que entrega {product.name}</h3>
    {query.isLoading?<Spinner />:query.isError?<div className="alert error">{errorMessage(query.error)}</div>:<>
      {query.data?<><StatusBadge value={query.data.status} /><p>{current.data?`${current.data.providerKey} · ${current.data.name} · ID externo ${current.data.externalServiceId}`:"Cargando servicio asociado…"}</p></>:<p>Sin proveedor asociado: entrega del negocio.</p>}
      <p>Busque la nueva ID en el catálogo sincronizado del proveedor. El cambio no modifica precios ni redirige órdenes ya enviadas. Revise los requisitos de la nueva opción.</p>
      <Field label="Buscar servicio del proveedor por nombre o ID" maxLength={160} value={search} onChange={e=>{setSearch(e.target.value);setOffset(0);setSelected("");}} />
      {services.isError?<div className="alert error">{errorMessage(services.error)}</div>:<SelectField label="Nuevo servicio del proveedor" value={selected} disabled={disabled} onChange={e=>setSelected(e.target.value)}>
        <option value="">Seleccionar servicio…</option>{services.data?.map(s=><option key={s.id} value={s.id}>{s.providerKey} · {s.externalServiceId} · {s.name}</option>)}
      </SelectField>}
      <div className="form-actions">
        <Button type="button" className="secondary" disabled={!offset} onClick={()=>setOffset(v=>Math.max(0,v-25))}>Anterior</Button>
        <Button type="button" className="secondary" disabled={(services.data?.length??0)<25} onClick={()=>setOffset(v=>v+25)}>Más servicios</Button>
        <Button type="button" disabled={disabled||!selected} onClick={()=>{if(window.confirm("¿Actualizar el servicio que entregará las compras futuras de este producto?"))mutation.mutate({providerServiceId:selected});}}>Guardar vínculo</Button>
        {query.data&&<Button type="button" className="secondary" disabled={disabled} onClick={()=>mutation.mutate({providerServiceId:query.data!.providerServiceId,status:query.data!.status==="active"?"inactive":"active"})}>{query.data.status==="active"?"Desactivar vínculo":"Activar vínculo"}</Button>}
      </div>
      {mutation.isError&&<div className="alert error">{errorMessage(mutation.error)}</div>}
    </>}
  </article>;
}
