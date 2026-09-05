import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as api from "../../lib/api/client";
import { integrationsApi } from "../../lib/api/resources";
import { BusinessProvider } from "../businesses/business-context";
import { SalesAutomationPage } from "./SalesAutomationPage";

const business={id:"30292e18-abfd-43c1-946d-8e18489a39a5",name:"Negocio test",currency:"CLP",status:"active" as const,role:"owner" as const};
const overview={settings:{enabled:false,displayName:"Asistente test",welcome:"Hola",policies:"",humanContact:"Equipo humano",telegramChatId:"123456",autoDispatch:false,evidenceRetentionDays:30},
  reviewers:[],sessions:[],checkouts:[],reviews:[],failures:[],inboxFailures:[]};
function mount(role:"owner"|"operator"="owner") {
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  return render(<QueryClientProvider client={client}><BusinessProvider business={{...business,role}}><SalesAutomationPage /></BusinessProvider></QueryClientProvider>);
}
beforeEach(()=>{vi.spyOn(integrationsApi,"list").mockResolvedValue([]);});
test("operator cannot load configuration or reviewer identities",()=>{
  const request=vi.spyOn(api,"apiRequest");mount("operator");
  expect(screen.getByText(/Solo owner y admin/)).toBeInTheDocument();expect(request).not.toHaveBeenCalled();
});
test("owner edits business-scoped settings; real dispatch requires explicit confirmation",async()=>{
  const request=vi.spyOn(api,"apiRequest").mockResolvedValue(overview);
  const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);
  mount();await screen.findByText("Operación del canal");
  await userEvent.click(screen.getByLabelText("Despachar automáticamente después del pago"));
  await userEvent.click(screen.getByRole("button",{name:"Guardar configuración"}));
  expect(confirm).toHaveBeenCalled();expect(request).toHaveBeenCalledTimes(1);
  confirm.mockReturnValue(true);
  await userEvent.click(screen.getByRole("button",{name:"Guardar configuración"}));
  await waitFor(()=>expect(request).toHaveBeenCalledWith(`/businesses/${business.id}/sales-automation`,{method:"PUT",body:expect.objectContaining({autoDispatch:true})}));
});
test("failed inbox messages provide a scoped recovery action",async()=>{
  const request=vi.spyOn(api,"apiRequest").mockResolvedValue({...overview,inboxFailures:[{id:"job-id",contact:"56912345678",attempts:8}]});
  mount();await userEvent.click(await screen.findByRole("button",{name:"Reprocesar"}));
  await waitFor(()=>expect(request).toHaveBeenCalledWith(`/businesses/${business.id}/sales-automation/jobs/retry`,{method:"POST",body:{kind:"inbox",id:"job-id"}}));
});
test("human handoff can record its outcome and resume the bot",async()=>{
  const request=vi.spyOn(api,"apiRequest").mockResolvedValue({...overview,sessions:[{
    id:"session-id",contact:"56912345678",paused:true,phase:"browse",resolutions:null,updatedAt:"2026-09-04T12:00:00.000Z",
  }]});
  mount();await userEvent.click(await screen.findByRole("button",{name:"Registrar gestión"}));
  await userEvent.selectOptions(screen.getByLabelText("Resultado"),"sale_completed");
  await userEvent.type(screen.getByLabelText("Nota de la gestión"),"Venta terminada por el equipo");
  await userEvent.click(screen.getByLabelText("Reanudar el bot al guardar"));
  await userEvent.click(screen.getByRole("button",{name:"Guardar resultado"}));
  await waitFor(()=>expect(request).toHaveBeenCalledWith(
    `/businesses/${business.id}/sales-automation/sessions/session-id/resolution`,
    {method:"POST",body:{outcome:"sale_completed",note:"Venta terminada por el equipo",resumeBot:true}},
  ));
});
