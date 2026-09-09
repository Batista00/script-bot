import { expect, it } from "vitest";
import { productPayload } from "./product-delivery-form";
it("preserves legacy configuration without changing product type",()=>{
  expect(productPayload({type:"service",deliveryConfig:null})).toEqual({type:"service",deliveryConfig:null});
});
it("physical and digital configurations use product type, not SMM service type",()=>{
  for(const kind of ["physical","digital"]){
    const deliveryConfig={kind,methods:kind==="physical"?["shipping","pickup"]:["digital"],processing:"manual"};
    expect(productPayload({type:"service",deliveryConfig})).toEqual({type:"product",deliveryConfig});
  }
});
it("service delivery keeps service classification",()=>{
  expect(productPayload({deliveryConfig:{kind:"service"}}).type).toBe("service");
});
