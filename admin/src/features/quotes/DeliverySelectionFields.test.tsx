import { render,screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeliverySelectionFields } from "./DeliverySelectionFields";
test("quote asks for address and configured zone without accepting a fee",async()=>{
  const user=userEvent.setup();const {container}=render(<form><DeliverySelectionFields config={{kind:"physical",methods:["pickup","shipping"],processing:"manual",instructions:"",pickupAddress:"Local 123",shipping:{mode:"zones",zones:[{name:"Centro",fee:1500}]}}} /></form>);
  expect(JSON.parse(String(new FormData(container.querySelector("form")!).get("delivery")))).toEqual({method:"pickup"});
  await user.selectOptions(screen.getByLabelText("Modalidad"),"shipping");
  await user.type(screen.getByLabelText("Dirección completa"),"Dirección del cliente 456");await user.selectOptions(screen.getByLabelText("Zona de despacho"),"Centro");
  expect(JSON.parse(String(new FormData(container.querySelector("form")!).get("delivery")))).toEqual({method:"shipping",address:"Dirección del cliente 456",zone:"Centro"});
});
