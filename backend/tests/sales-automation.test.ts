import assert from "node:assert/strict";
import { test } from "node:test";
import { command } from "../src/modules/sales/sales-conversation.service.js";
import { validateEvidence } from "../src/modules/payment-reviews/payment-reviews.service.js";
import { verifySharedSecret } from "../src/integrations/telegram/telegram.service.js";
import { humanResolutionSchema,inboxSchema,messageSchema,settingsSchema,typebotSessionSchema,validated } from "../src/modules/sales/sales.schema.js";
import { defaultSalesSettings } from "../src/modules/sales/sales.types.js";
import { SmmRajaFulfillmentAdapter } from "../src/integrations/smm-raja/smm-raja.fulfillment.adapter.js";
import type { IntegrationsService } from "../src/modules/integrations/integrations.service.js";
import type { SmmRajaFulfillmentHttpClient } from "../src/integrations/smm-raja/smm-raja.client.js";
import { AutomationService } from "../src/modules/automation/automation.service.js";
import { PostgresSalesRepository } from "../src/modules/sales/sales.repository.js";
import { SalesAccessService } from "../src/modules/sales/sales-access.service.js";
import { SalesAdminService } from "../src/modules/sales/sales-admin.service.js";
import type { SalesSession } from "../src/modules/sales/sales.types.js";
import type { BotGatewayService } from "../src/modules/bot-gateway/bot-gateway.service.js";
import type { SalesDeliveryService } from "../src/modules/sales/sales-delivery.service.js";
import type { PostgresNotificationsRepository } from "../src/modules/automation/notifications.repository.js";
import type { PaymentReviewsService } from "../src/modules/payment-reviews/payment-reviews.service.js";
import { describeEvidenceAnalysis,evidenceAnalysisSchema } from "../src/modules/payment-reviews/evidence-analysis.js";
import { buildApp } from "../src/app.js";
import type { Pool } from "pg";

test("session locks reserve pool capacity and release it after completion",async()=>{
  let unlock!:()=>void;let entered!:()=>void;let releases=0;
  const ready=new Promise<void>(resolve=>{entered=resolve;});
  const client={query:async()=>({rows:[{locked:true}]}),release:()=>{releases++;}};
  const sales=new PostgresSalesRepository({options:{max:2},connect:async()=>client} as unknown as Pool);
  const first=sales.exclusive("first",async()=>{entered();await new Promise<void>(resolve=>{unlock=resolve;});});
  await ready;
  await assert.rejects(()=>sales.exclusive("second",async()=>undefined),{code:"SALES_BUSY"});
  unlock();await first;
  assert.equal(await sales.exclusive("next",async()=>42),42);assert.equal(releases,2);
});

test("evidence analysis cannot carry approval instructions or authorize payment",()=>{
  const analysis={amount:"200",currency:"CLP",recipient:"Prueba",bankReference:null,observations:"Texto observado"};
  assert.equal(evidenceAnalysisSchema.safeParse({...analysis,approved:true}).success,false);
  assert.match(describeEvidenceAnalysis(analysis,200,"CLP"),/NO prueba abono/);
  assert.match(describeEvidenceAnalysis({...analysis,amount:"100"},200,"CLP"),/monto diferente/);
  assert.match(describeEvidenceAnalysis({...analysis,amount:null},200,"CLP"),/requiere revisión humana/);
});

test("sales HTTP endpoints deny absent session/machine/human authority; health remains available",async(t)=>{
  const app=await buildApp({NODE_ENV:"test",PORT:3000,DATABASE_URL:"postgresql://unused:unused@localhost/unused",LOG_LEVEL:"silent",AUTH_SESSION_TTL_HOURS:168});
  t.after(()=>app.close());
  for(const url of ["/bot/v1/sales/sessions","/bot/v1/sales/inbox","/conversation/v1/message","/conversation/v1/evidence","/conversation/v1/evidence/analysis"]) {
    assert.equal((await app.inject({method:"POST",url,payload:{}})).statusCode,401,url);
  }
  assert.equal((await app.inject({method:"PUT",url:"/conversation/v1/typebot-session",payload:{typebotSessionId:"typebot-session"}})).statusCode,401);
  assert.equal((await app.inject({method:"GET",url:"/businesses/30292e18-abfd-43c1-946d-8e18489a39a5/sales-automation"})).statusCode,401);
  assert.equal((await app.inject({method:"GET",url:"/health"})).statusCode,200);
});

test("sales commands normalize accents without changing commercial input values",()=>{
  assert.equal(command("  CATÁLOGO  "),"catalogo");assert.equal(command("MÁS"),"mas");
});
test("HTTP input rejects injected business/payment approval fields",()=>{
  assert.throws(()=>validated(messageSchema,{messageId:"1",text:"hola",businessId:"foreign"}));
  assert.throws(()=>validated(messageSchema,{messageId:"1",text:"hola",approved:true}));
  assert.throws(()=>validated(inboxSchema,{messageId:"1",text:"hola",image:false,contact:"123@g.us"}));
  assert.throws(()=>validated(settingsSchema,{...defaultSalesSettings,botToken:"not-allowed"}));
  assert.throws(()=>validated(typebotSessionSchema,{typebotSessionId:"typebot-session",businessId:"foreign"}));
  assert.throws(()=>validated(humanResolutionSchema,{outcome:"sale_completed",note:"Atendido",resumeBot:true,approved:true}));
});
test("human handoff result is business-scoped, retained and can resume the bot",async()=>{
  const saved:SalesSession[]=[];
  const session:SalesSession={id:"session-a",businessId:"business-a",customerId:"customer-a",contact:"56911111111",
    state:{phase:"browse"},paused:true,typebotSessionId:null};
  const repository={
    exclusive:async(_key:string,operation:()=>Promise<unknown>)=>operation(),
    session:async(businessId:string,id:string)=>{
      assert.equal(businessId,"business-a");assert.equal(id,"session-a");return session;
    },
    saveSession:async(value:SalesSession)=>{saved.push(structuredClone(value));},
  } as unknown as PostgresSalesRepository;
  const service=new SalesAdminService(repository,{} as never,{} as never,{} as never);
  const result=await service.resolveHumanHandoff("business-a","session-a","user-a",{
    outcome:"sale_completed",note:"Venta finalizada por WhatsApp",resumeBot:true,
  });
  assert.equal(result.paused,false);assert.equal(saved.length,1);
  assert.deepEqual(saved[0]?.state.humanResolutions?.map(({outcome,note,resolvedBy})=>({outcome,note,resolvedBy})),[
    {outcome:"sale_completed",note:"Venta finalizada por WhatsApp",resolvedBy:"user-a"},
  ]);
  await assert.rejects(()=>service.resolveHumanHandoff("business-a","session-a","user-a",{
    outcome:"other",note:"Segundo cierre",resumeBot:false,
  }),{code:"SALES_SESSION_NOT_IN_HUMAN_HANDOFF"});
});
test("Typebot session replacement uses the authenticated business and commercial session",async()=>{
  const writes:Array<[string,string,string|null]>=[];
  const repository={
    token:async()=>({businessId:"business-a",sessionId:"sales-a"}),
    setTypebotSession:async(businessId:string,sessionId:string,typebotSessionId:string|null)=>{writes.push([businessId,sessionId,typebotSessionId]);},
  } as unknown as PostgresSalesRepository;
  const service=new SalesAccessService(repository,{} as BotGatewayService);
  const token=`cs_${"a".repeat(43)}`;
  assert.deepEqual(await service.setTypebotSession(`Bearer ${token}`,"typebot-a"),{ok:true,typebotSessionId:"typebot-a"});
  assert.deepEqual(writes,[["business-a","sales-a","typebot-a"]]);
  await service.setTypebotSession(`Bearer ${token}`,null);
  assert.deepEqual(writes[1],["business-a","sales-a",null]);
});
test("shared webhook authentication rejects absent, short or incorrect secrets",()=>{
  assert.equal(verifySharedSecret(undefined,"a".repeat(32)),false);
  assert.equal(verifySharedSecret("short","short"),false);
  assert.equal(verifySharedSecret("b".repeat(32),"a".repeat(32)),false);
  assert.equal(verifySharedSecret("a".repeat(32),"a".repeat(32)),true);
});
test("evidence rejects HTML, MIME mismatch, invalid encoding and oversized data",()=>{
  assert.throws(()=>validateEvidence({mimeType:"image/png",base64:Buffer.from("<script>alert(1)</script>").toString("base64")}));
  assert.throws(()=>validateEvidence({mimeType:"image/jpeg",base64:"not base64"}));
  assert.throws(()=>validateEvidence({mimeType:"image/png",base64:"x".repeat(2_800_001)}));
});
test("Raja prepayment validation checks comment quantity without calling Raja",()=>{
  const adapter=new SmmRajaFulfillmentAdapter({} as IntegrationsService,{} as SmmRajaFulfillmentHttpClient);
  const input={businessId:"b",integrationId:"i",externalServiceId:"opaque",serviceType:"Custom Comments",quantity:2,
    fulfillmentInput:{targetUrl:"https://example.com/post",comments:"Uno\nDos"}};
  assert.doesNotThrow(()=>adapter.validateOrder(input));
  assert.throws(()=>adapter.validateOrder({...input,quantity:3}));
  assert.throws(()=>adapter.validateOrder({...input,fulfillmentInput:{...input.fulfillmentInput,comments:"Uno\n\nDos"}}));
  assert.throws(()=>adapter.validateOrder({...input,serviceType:"unverified"}));
});
for(const status of ["submission_unknown","submitting","failed"] as const) {
  test(`automation never resubmits ${status} provider orders`,async()=>{
    let dispatches=0;const events:string[]=[];
    const checkout={id:"checkout",businessId:"b",sessionId:"s",orderId:"o",lastOrderStatus:"paid",delivery:{mode:"provider"}};
    const sales={exclusive:async(_key:string,fn:()=>Promise<unknown>)=>fn(),settings:async()=>({...defaultSalesSettings,enabled:true,autoDispatch:true}),
      cleanExpired:async()=>{},due:async()=>[checkout],session:async()=>({contact:"56911111111",state:{}}),checkpoint:async()=>{}} as unknown as PostgresSalesRepository;
    const gateway={getOrder:async()=>({orderId:"o",status:"paid",total:100,currency:"CLP"}),
      listFulfillments:async()=>[{status,fulfillmentId:"f"}],dispatchFulfillment:async()=>{dispatches++;}} as unknown as BotGatewayService;
    const queue={enqueue:async(_b:string,key:string)=>{events.push(key);}} as unknown as PostgresNotificationsRepository;
    const service=new AutomationService(sales,gateway,{} as SalesDeliveryService,queue,{} as PaymentReviewsService);
    await service.tick("b");assert.equal(dispatches,0);assert.ok(events.some(e=>e.startsWith("attention:")));
  });
}
