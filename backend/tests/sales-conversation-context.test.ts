import assert from "node:assert/strict";
import {test} from "node:test";
import {SalesConversationService} from "../src/modules/sales/sales-conversation.service.js";
import {salesContext,conversationalIntent} from "../src/modules/sales/sales-context.js";
import {SalesInboxService} from "../src/modules/sales/sales-inbox.service.js";
import {defaultSalesSettings,type SalesSession} from "../src/modules/sales/sales.types.js";

function fixture(){
  const session:SalesSession={id:"s",businessId:"a",customerId:"c",contact:"56912345678",paused:false,typebotSessionId:null,state:{phase:"inputs",greeted:true}};
  const settings={...defaultSalesSettings,enabled:true,displayName:"Negocio A",policies:"Garantía sólo según descripción del producto.",telegramChatId:"123"};
  const events:unknown[]=[];
  const saved=new Map<string,unknown>();
  const products=Array.from({length:12},(_,i)=>({productId:`p${i}`,categoryId:"instagram",name:`Paquete ${(i+1)*500}`,description:null,minQuantity:(i+1)*500,maxQuantity:(i+1)*500,requiredInputs:[]}));
  const repo={commercialCategories:async()=>[],catalogByTermGroups:async(b:string,_groups:string[][],_offset:number,limit:number)=>{assert.equal(b,"a");assert.equal(limit,101);return products.map(p=>p.productId);},
    catalog:async()=>products.map(p=>p.productId),exclusive:async(_id:string,fn:()=>Promise<unknown>)=>fn(),session:async(b:string)=>{assert.equal(b,"a");return session;},
    settings:async()=>settings,message:async(_s:unknown,id:string)=>saved.get(id),
    beginMessage:async()=>{},finishMessage:async(_s:unknown,id:string,response:unknown)=>{saved.set(id,{response});}};
  let statusCalls=0,aiCalls=0;
  const gateway={listCategories:async()=>[{categoryId:"instagram",name:"Instagram Seguidores"}],getProduct:async(b:string,id:string)=>{assert.equal(b,"a");return products.find(p=>p.productId===id);},listPrices:async()=>[]};
  const service=new SalesConversationService(repo as never,gateway as never,
    {status:async()=>{statusCalls++;return {text:"Pedido pendiente; no se ha enviado."};}} as never,
    {enqueue:async(...args:unknown[])=>{events.push(args);}} as never,
    {isConfigured:()=>true,interpret:async()=>{aiCalls++;throw new Error("No second model call");}});
  return {session,settings,service,events,statusCalls:()=>statusCalls,aiCalls:()=>aiCalls};
}
test("FAQ retains selected commercial state and sends business policies as data",async()=>{
  const f=fixture();
  const reply=await f.service.receive("a","s",{messageId:"faq",text:"¿Son reales?",presentation:"typebot"});
  assert.equal(f.session.state.phase,"inputs");
  assert.equal(reply.context?.assistantName,"Negocio A");
  assert.equal(reply.context?.policies,f.settings.policies);
  assert.equal(f.aiCalls(),0);
});
test("repeat greeting does not reset an in-progress purchase",async()=>{
  const f=fixture();
  const reply=await f.service.receive("a","s",{messageId:"hello",text:"hola",presentation:"typebot"});
  assert.equal(f.session.state.phase,"inputs");
  assert.doesNotMatch(reply.text,/¡Hola!/);
});
test("natural greetings are not catalog searches and retain checkout state",async()=>{
  for(const text of ["hola buenas noches","¡Hola, buenas tardes!","buenos días","hola ¿cómo estás?"]){
    const f=fixture();f.session.state.greeted=false;f.session.state.checkoutId="existing";
    const reply=await f.service.receive("a","s",{messageId:text,text,presentation:"typebot"});
    assert.equal(f.session.state.phase,"inputs");assert.equal(f.session.state.checkoutId,"existing");
    assert.match(reply.text,/soporte/);assert.doesNotMatch(reply.text,/No encontré|HUMANO/);assert.equal(f.aiCalls(),0);
  }
  assert.equal(conversationalIntent("hola busco seguidores de instagram"),null);
});
test("help offers sales and support without pausing; explicit requests notify Telegram once",async()=>{
  const help=fixture();const reply=await help.service.receive("a","s",{messageId:"h",text:"qué puedes hacer",presentation:"typebot"});
  assert.match(reply.text,/ventas o soporte/);assert.equal(help.session.paused,false);assert.equal(help.events.length,0);
  for(const text of ["ventas","necesito soporte","quiero un agente"]){const f=fixture();
    await f.service.receive("a","s",{messageId:"h",text,presentation:"typebot"});
    assert.equal(f.session.paused,true);assert.equal(f.events.length,1);
  }
});
test("category contains every returned product and quantity selection uses the same ordered choices",async()=>{
  const f=fixture();f.session.state.phase="browse";
  const catalog=await f.service.receive("a","s",{messageId:"cat",text:"seguidores de instagram",presentation:"typebot"});
  assert.equal(catalog.context?.options.length,12);assert.match(catalog.text,/Paquete 6000/);
  await f.service.receive("a","s",{messageId:"missing",text:"7000",presentation:"typebot"}).then(reply=>{
    assert.match(reply.text,/7000.*no hay una opción única/);assert.match(reply.text,/Paquete 6000/);
    assert.equal(f.session.state.phase,"browse");assert.equal(f.session.state.choices?.length,12);
  });
  // An input requirement prevents a quote call in this fixture; selection remains deterministic.
  f.session.state.choices![9]!.requiredInputs=[{key:"url",label:"Enlace",type:"url",required:true,helpText:null,position:0,validation:{}}];
  await f.service.receive("a","s",{messageId:"5000",text:"5000",presentation:"typebot"});
  assert.equal(f.session.state.quantity,5000);assert.equal(f.session.state.product?.productId,"p9");
  assert.equal(f.session.state.phase,"inputs");assert.equal(f.aiCalls(),0);
});
test("support includes the reason and verified order state before Telegram",async()=>{
  const f=fixture();f.session.state.checkoutId="checkout";
  await f.service.receive("a","s",{messageId:"help",text:"Mi pedido está retrasado",presentation:"typebot"});
  assert.equal(f.statusCalls(),1);
  assert.equal(f.session.paused,true);
  assert.match(JSON.stringify(f.events),/retrasado/);
  assert.match(JSON.stringify(f.events),/no se ha enviado/);
  const silent=await f.service.receive("a","s",{messageId:"next",text:"hola",presentation:"typebot"});
  assert.equal(silent.text,"");
  assert.equal(f.events.length,1);
});
test("public context omits other customer identity, provider IDs and tokens",()=>{
  const f=fixture(),context=salesContext(f.session,f.settings);
  assert.equal("businessId" in context,false);
  assert.equal("customerId" in context,false);
  assert.equal("sessionToken" in context,false);
  assert.equal(context.returningCustomer,false);
});
test("special pricing and distribution request human review, never invented packages",()=>{
  for(const text of ["precio especial","distribuir likes","https://example.com/a https://example.com/b"])assert.equal(conversationalIntent(text),"special");
});
test("leased turn resolution rejects absent, foreign or expired proof",async()=>{
  const inbox=new SalesInboxService({leasedMessage:async(b:string,id:string,lease:string)=>b==="a"&&id==="i"&&lease==="valid"
    ? {contact:"56912345678",messageId:"original",text:"hola",image:false} : null} as never,{} as never);
  assert.equal((await inbox.resolve("a","i","valid")).messageId,"original");
  for(const [b,l] of [["b","valid"],["a","expired"]])await assert.rejects(()=>inbox.resolve(b!,"i",l!),{code:"SALES_TURN_UNAUTHORIZED"});
});
