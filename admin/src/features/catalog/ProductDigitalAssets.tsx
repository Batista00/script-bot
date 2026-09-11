import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { businessQueryKey } from "../../app/query-client";
import { Button, Field, SelectField, Spinner, useToast } from "../../components/ui";
import { apiRequest, errorMessage } from "../../lib/api/client";
import type { Product } from "../../lib/api/types";
import { useBusiness } from "../businesses/business-context";

interface Asset {id:string;kind:"download"|"license";label:string;status:"active"|"inactive";reserved:boolean}

export function ProductDigitalAssets({product}:{product:Product}){
  const business=useBusiness(),client=useQueryClient(),toast=useToast();
  const [kind,setKind]=useState<Asset["kind"]>("download"),[label,setLabel]=useState(""),[value,setValue]=useState("");
  const path=`/businesses/${business.id}/products/${product.id}/digital-assets`;
  const key=businessQueryKey("digital-assets",business.id,product.id);
  const allowed=business.role!=="operator"&&product.deliveryConfig?.kind==="digital";
  const query=useQuery({queryKey:key,queryFn:()=>apiRequest<Asset[]>(path),enabled:allowed});
  const add=useMutation({mutationFn:()=>apiRequest(path,{method:"POST",body:{kind,label,value}}),onSuccess:async()=>{
    setValue("");setLabel("");await client.invalidateQueries({queryKey:key});toast("Contenido guardado cifrado. Sólo se entrega después del pago confirmado.");
  }});
  const status=useMutation({mutationFn:(asset:Asset)=>apiRequest(`${path}/${asset.id}`,{method:"PATCH",body:{status:asset.status==="active"?"inactive":"active"}}),
    onSuccess:()=>client.invalidateQueries({queryKey:key})});
  if(!allowed)return null;
  return <section><h3>Contenido digital privado</h3>
    <p>Para productos propios sin proveedor asociado. Cada licencia se asigna a una sola compra; los enlaces pueden compartirse con todos sus compradores. Sólo se muestra el inventario, nunca los códigos guardados.</p>
    <p>Los archivos deben estar alojados en un enlace HTTPS de descarga. No añada credenciales administrativas. La entrega automática exige pago verificado.</p>
    <form onSubmit={e=>{e.preventDefault();add.mutate();}}>
      <SelectField label="Contenido privado" value={kind} onChange={e=>{setKind(e.target.value as Asset["kind"]);setValue("");}}>
        <option value="download">Enlace al archivo o descarga</option><option value="license">Licencia individual</option>
      </SelectField>
      <Field label="Etiqueta para el comprador" required maxLength={120} value={label} onChange={e=>setLabel(e.target.value)} />
      <Field label={kind==="download"?"Enlace HTTPS de descarga":"Código de licencia"} type={kind==="download"?"url":"password"} autoComplete="off" required maxLength={2048} value={value} onChange={e=>setValue(e.target.value)} />
      <Button type="submit" disabled={add.isPending}>Guardar contenido</Button>
    </form>
    {add.isError&&<div className="alert error">{errorMessage(add.error)}</div>}
    {status.isError&&<div className="alert error">{errorMessage(status.error)}</div>}
    {query.isLoading?<Spinner />:query.isError?<div className="alert error">{errorMessage(query.error)}</div>:<>
      <p>Últimos 100 contenidos registrados. {query.data?.filter(a=>a.kind==="license"&&a.status==="active"&&!a.reserved).length??0} licencias disponibles en esta lista.</p>
      {query.data?.map(asset=><p key={asset.id}>{asset.label} · {asset.kind==="license"?"Licencia":"Descarga"} · {asset.reserved?"Asignado a un pedido":asset.status==="active"?"Disponible":"Inactivo"}{" "}
        <Button type="button" className="secondary" disabled={asset.reserved||status.isPending} onClick={()=>status.mutate(asset)}>{asset.status==="active"?"Desactivar":"Activar"}</Button>
      </p>)}
    </>}
  </section>;
}
