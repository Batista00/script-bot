import { categoriesApi } from "../../lib/api/resources";
import type { Category } from "../../lib/api/types";
import { cell, EntityPage } from "../shared/EntityPage";
import { useQuery } from "@tanstack/react-query";
import { useBusiness } from "../businesses/business-context";

export function CategoriesPage() {
  const business=useBusiness();
  const parents=useQuery({queryKey:["categories",business.id,"parents"],queryFn:async()=>{
    const all:Category[]=[];
    for(let offset=0;;offset+=100) {
      const page=await categoriesApi.list(business.id,{limit:100,offset});all.push(...page);
      if(page.length<100) return all;
    }
  }});
  return <EntityPage<Category> resource="categories" title="Categorías"
    description="Categorías principales y subcategorías para orientar la venta del bot. Sin categoría padre significa principal." empty="No hay categorías."
    list={categoriesApi.list} create={categoriesApi.create} update={categoriesApi.update}
    columns={[{ label: "Nombre", value: (item) => item.name }, {label:"Categoría principal",value:item=>parents.data?.find(p=>p.id===item.parentId)?.name ?? "Principal"}, { label: "Estado", value: (item) => cell.status(item.status) }, { label: "Actualizada", value: (item) => new Date(item.updatedAt).toLocaleString() }]}
    fields={[{ name: "name", label: "Nombre", required: true }, {name:"parentId",label:"Categoría padre (opcional)",kind:"select",nullable:true,options:(parents.data??[]).filter(p=>!p.parentId).map(p=>({value:p.id,label:p.name}))}, { name: "status", label: "Estado", kind: "select", editOnly: true, options: [{ value: "active", label: "Activo" }, { value: "inactive", label: "Inactivo" }] }]}
  />;
}
