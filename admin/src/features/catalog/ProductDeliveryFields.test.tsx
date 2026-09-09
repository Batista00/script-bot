import { render,screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductDeliveryFields } from "./ProductDeliveryFields";
import { providerImportPayload } from "../providers/ProviderServicesPage";

test("physical form saves pickup and shipping zones without automatic dispatch",async()=>{
  const user=userEvent.setup();const {container}=render(<form><ProductDeliveryFields /></form>);
  await user.selectOptions(screen.getByLabelText("Naturaleza de la oferta"),"physical");
  await user.type(screen.getByLabelText("Dirección del local para retiro"),"Local de prueba 123");
  await user.click(screen.getByLabelText("Envío a domicilio"));
  await user.selectOptions(screen.getByLabelText("Costo de envío"),"zones");
  await user.type(screen.getByLabelText("Zona 1"),"Centro");
  await user.clear(screen.getByLabelText("Tarifa zona 1"));await user.type(screen.getByLabelText("Tarifa zona 1"),"1500");
  const form=new FormData(container.querySelector("form")!);
  expect(JSON.parse(String(form.get("deliveryConfig")))).toMatchObject({kind:"physical",methods:["pickup","shipping"],processing:"manual",pickupAddress:"Local de prueba 123",shipping:{mode:"zones",zones:[{name:"Centro",fee:1500}]}});
});
test("editing SMM keeps service classification and current delivery",()=>{
  const config={kind:"service",methods:["service"],processing:"automatic",instructions:"Consulte el plazo del servicio"} as const;
  const {container}=render(<form><ProductDeliveryFields value={JSON.parse(JSON.stringify(config))} /></form>);
  expect(JSON.parse(String(new FormData(container.querySelector("form")!).get("deliveryConfig")))).toEqual(config);
  expect(screen.queryByLabelText("Envío a domicilio")).not.toBeInTheDocument();
});

test("own digital products can require both downloads and individual licenses",async()=>{
  const user=userEvent.setup(),{container}=render(<form><ProductDeliveryFields /></form>);
  await user.selectOptions(screen.getByLabelText("Naturaleza de la oferta"),"digital");
  await user.selectOptions(screen.getByLabelText("Contenido digital a entregar"),"both");
  const config=JSON.parse(String(new FormData(container.querySelector("form")!).get("deliveryConfig")));
  expect(config).toMatchObject({kind:"digital",digitalContents:"both",methods:["digital"]});
  expect(screen.queryByLabelText("Envío a domicilio")).not.toBeInTheDocument();
});
test("provider import uses the same optional physical delivery payload",()=>{
  const data=new FormData();data.set("name","Producto importado");data.set("type","service");data.set("currency","CLP");
  data.set("pricingType","fixed");data.set("retailPrice","3000");data.set("status","active");
  const config={kind:"physical",methods:["pickup"],processing:"manual",pickupAddress:"Local 123",instructions:""};
  data.set("deliveryConfig",JSON.stringify(config));
  const body=providerImportPayload("0112b819-6653-4234-821a-6a2fce393c3f",data);
  expect(body.type).toBe("product");expect(body.deliveryConfig).toEqual(config);
});
