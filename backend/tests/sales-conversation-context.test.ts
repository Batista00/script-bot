import assert from "node:assert/strict";
import {test} from "node:test";
import {SalesConversationService} from "../src/modules/sales/sales-conversation.service.js";
import {salesContext,conversationalIntent} from "../src/modules/sales/sales-context.js";
import {SalesInboxService} from "../src/modules/sales/sales-inbox.service.js";
import {defaultSalesSettings,type SalesSession} from "../src/modules/sales/sales.types.js";

function fixture(categories:Array<{id:string;name:string;parentId:string|null}>=[]){
  const session:SalesSession={id:"s",businessId:"a",customerId:"c",contact:"56912345678",paused:false,typebotSessionId:null,state:{phase:"inputs",greeted:true}};
  const settings={...defaultSalesSettings,enabled:true,displayName:"Negocio A",policies:"Garantía sólo según descripción del producto.",telegramChatId:"123"};
  const events:unknown[]=[];
  const saved=new Map<string,{requestHash:string;response:unknown}>();
  const searches:string[][][]=[];
  const products=Array.from({length:12},(_,i)=>({productId:`p${i}`,categoryId:"instagram",name:`Paquete ${(i+1)*500}`,description:null,minQuantity:(i+1)*500,maxQuantity:(i+1)*500,requiredInputs:[]}));
  const repo={commercialCategories:async()=>categories,catalogByTermGroups:async(b:string,groups:string[][],_offset:number,limit:number)=>{assert.equal(b,"a");assert.equal(limit,101);searches.push(groups);return products.map(p=>p.productId);},
    catalog:async()=>products.map(p=>p.productId),exclusive:async(_id:string,fn:()=>Promise<unknown>)=>fn(),session:async(b:string)=>{assert.equal(b,"a");return session;},
    settings:async()=>settings,message:async(_s:unknown,id:string)=>saved.get(id),
    beginMessage:async(_s:unknown,id:string,requestHash:string)=>{saved.set(id,{requestHash,response:null});},
    finishMessage:async(_s:unknown,id:string,response:unknown)=>{saved.set(id,{requestHash:saved.get(id)!.requestHash,response:structuredClone(response)});}};
  let statusCalls=0,aiCalls=0;
  const gateway={listPaymentMethods:async()=>[],listCategories:async()=>[{categoryId:"instagram",name:"Instagram Seguidores"}],
    getProduct:async(b:string,id:string)=>{assert.equal(b,"a");return products.find(p=>p.productId===id);},
    listPrices:async(_b:string,id:string)=>[{pricingType:"fixed",fixedPrice:4990,currency:"CLP",
      minQuantity:products.find(p=>p.productId===id)!.minQuantity,maxQuantity:products.find(p=>p.productId===id)!.maxQuantity}]};
  const service=new SalesConversationService(repo as never,gateway as never,
    {status:async()=>{statusCalls++;return {text:"Pedido pendiente; no se ha enviado."};}} as never,
    {enqueue:async(...args:unknown[])=>{events.push(args);}} as never,
    {isConfigured:()=>true,interpret:async()=>{aiCalls++;throw new Error("No second model call");}});
  return {session,settings,service,events,saved,searches,statusCalls:()=>statusCalls,aiCalls:()=>aiCalls};
}

const navigationCategories=[{id:"ig",name:"Instagram",parentId:null},
  {id:"instagram",name:"Instagram Seguidores",parentId:"ig"},{id:"likes",name:"Instagram Likes",parentId:"ig"}];

test("prepare persists Instagram → Seguidores → Precios with optional conversational turns",async()=>{
  for(const intermediate of [[],["Sí"],["¿cómo funciona?","hola"]]){
    const f=fixture(navigationCategories);f.session.state={phase:"browse"};
    let n=0;const send=(text:string)=>f.service.prepare("a","s",{messageId:`nav-${++n}:agent:0`,text,presentation:"typebot"});
    const platform=await send("Instagram");
    assert.match(platform.context!.catalogListing!,/Instagram Seguidores/);assert.equal(f.session.state.categoryId,"ig");
    for(const text of intermediate){const before=structuredClone(f.session.state);await send(text);assert.deepEqual(f.session.state,before);}
    await send("Seguidores");assert.equal(f.session.state.categoryId,"instagram");
    assert.ok(f.session.state.termGroups?.some(g=>g.includes("seguidores")));
    for(const text of ["Precios","opciones","cuánto sale"]){
      const reply=await send(text);assert.match(reply.context!.catalogListing!,/4.990 CLP/);
      assert.equal(reply.context!.products.length,12);assert.equal(f.session.state.categoryId,"instagram");
      assert.equal(f.session.state.product,undefined);assert.equal(f.session.state.checkoutId,undefined);
      assert.equal(f.session.state.phase,"browse");
    }
    const before=structuredClone(f.session.state);
    assert.deepEqual(await f.service.prepare("a","s",{messageId:"nav-1:agent:0",text:"Instagram",presentation:"typebot"}),platform);
    assert.deepEqual(f.session.state,before);assert.equal(f.events.length,0);
  }
});

test("price follow-ups clarify absent or ambiguous context without choosing products",async()=>{
  for(const text of ["precios","opciones","cuánto sale"]){
    const f=fixture(navigationCategories);f.session.state={phase:"browse"};
    const reply=await f.service.prepare("a","s",{messageId:"missing",text,presentation:"typebot"});
    assert.match(reply.context!.catalogListing!,/De qué plataforma/);assert.equal(reply.context!.products.length,0);
    assert.equal(f.searches.length,0);assert.equal(f.session.state.categoryId,undefined);
    const selected=await f.service.prepare("a","s",{messageId:"known",text:"seguidores de instagram porfavor",presentation:"typebot"});
    assert.match(selected.context!.catalogListing!,/4.990 CLP/);
    delete f.session.state.termGroups;delete f.session.state.categoryId;
    f.session.state.choices![0]!.categoryId="likes";
    const ambiguous=await f.service.prepare("a","s",{messageId:"ambiguous",text,presentation:"typebot"});
    assert.match(ambiguous.context!.catalogListing!,/De qué plataforma/);assert.equal(f.searches.length,1);
    assert.equal(f.session.state.product,undefined);
  }
});

test("price follow-ups can reuse a scoped category or unambiguous choices without termGroups",async()=>{
  const f=fixture(navigationCategories);f.session.state={phase:"browse",categoryId:"instagram"};
  const category=await f.service.prepare("a","s",{messageId:"category",text:"precios",presentation:"typebot"});
  assert.match(category.context!.catalogListing!,/4.990 CLP/);
  delete f.session.state.categoryId;delete f.session.state.termGroups;
  const choices=await f.service.prepare("a","s",{messageId:"choices",text:"opciones",presentation:"typebot"});
  assert.match(choices.context!.catalogListing!,/4.990 CLP/);assert.equal(f.session.state.categoryId,"instagram");
  assert.equal(f.searches.length,2);assert.equal(f.session.state.product,undefined);
});

test("prepare returns real catalog prices without an OpenAI tool call or product selection",async()=>{
  for(const text of ["¿Cuánto salen 1000 seguidores de Instagram?","precio de 1000 seguidores instagram",
    "Quiero comprar 1000 seguidores","qué opciones de seguidores de Instagram tienen","muéstrame seguidores de TikTok",
    "seguidores de instagram porfavor","seguidores de instagram","1000 seguidores de Instagram por favor","likes TikTok"]){
    const f=fixture();f.session.state={phase:"browse"};
    const reply=await f.service.prepare("a","s",{messageId:"price:agent:0",text,presentation:"typebot"});
    assert.match(reply.context!.catalogListing!,/4.990 CLP/);assert.equal(reply.context!.options.length,12);
    assert.equal(reply.context!.catalogListing,reply.catalogText);assert.equal(f.searches.length,1);
    assert.equal(f.session.state.phase,"browse");assert.equal(f.session.state.product,undefined);
    assert.equal(f.session.state.quantity,undefined);assert.equal(f.session.state.checkoutId,undefined);
    assert.equal(f.aiCalls(),0);assert.equal(f.events.length,0);
    if(text.includes("TikTok"))assert.ok(f.searches[0]!.some(group=>group.includes("tiktok")));
  }
});

test("prepare leaves FAQs, greetings, ambiguous text and handoff intents to the conversational agent",async()=>{
  for(const text of ["¿Cómo funciona este servicio?","Hola buenas noches","¿son bots?","¿cuánto demora?",
    "Gracias por la información","sí","quiero comprar","muéstrame algo","No quiero comprar seguidores",
    "No quiero seguidores de Instagram","Me gustan los seguidores de Instagram","seguidores","Instagram",
    "¿Son bots los seguidores de Instagram?","¿cuánto demoran los seguidores de Instagram?",
    "precio especial de seguidores","quiero comprar seguidores pero necesito soporte","cuánto cuestan seguidores y cómo funciona"]){
    const f=fixture();f.session.state={phase:"browse"};const before=structuredClone(f.session.state);
    const reply=await f.service.prepare("a","s",{messageId:"normal",text,presentation:"typebot"});
    assert.equal(reply.context!.catalogListing,null,text);assert.match(reply.text,/Converse con el cliente/);
    assert.deepEqual(f.session.state,before);assert.equal(f.searches.length,0);assert.equal(f.saved.size,0);
  }
});

test("prepare never changes active purchase phases, required inputs, pause or opt-out",async()=>{
  for(const phase of ["quantity","inputs","delivery","confirm","payment","awaiting"] as const){
    for(const text of ["precio de seguidores instagram","Instagram","Seguidores","Precios"]){
      const f=fixture(navigationCategories);f.session.state.phase=phase;const before=structuredClone(f.session.state);
      await f.service.prepare("a","s",{messageId:"price",text,presentation:"typebot"});
      assert.deepEqual(f.session.state,before);assert.equal(f.searches.length,0);
    }
  }
  for(const paused of [true,false]){
    const f=fixture();f.session.state={phase:"browse",optedOut:!paused};f.session.paused=paused;
    const reply=await f.service.prepare("a","s",{messageId:"silent",text:"precio de seguidores instagram",presentation:"typebot"});
    assert.equal(reply.paused,true);assert.equal(reply.text,"");assert.equal(f.searches.length,0);
  }
});

test("prepare replay is idempotent after a later catalog tool call and rejects changed content",async()=>{
  const f=fixture();f.session.state={phase:"browse"};
  const message={messageId:"same:agent:0",text:"precio de 1000 seguidores instagram",presentation:"typebot" as const};
  const first=await f.service.prepare("a","s",message);
  assert.deepEqual(await f.service.prepare("a","s",message),first);assert.equal(f.searches.length,1);
  const action={...message,messageId:"same:agent:1",decision:{action:"catalog" as const,search:"seguidores instagram"}};
  const tool=await f.service.receive("a","s",action);
  assert.match(tool.context!.catalogListing!,/4.990 CLP/);assert.equal(f.searches.length,2);
  assert.deepEqual(await f.service.receive("a","s",action),tool);assert.equal(f.searches.length,2);
  f.session.state.phase="inputs";const before=structuredClone(f.session.state);
  assert.deepEqual(await f.service.prepare("a","s",message),first);assert.deepEqual(f.session.state,before);
  await assert.rejects(()=>f.service.prepare("a","s",{...message,text:"hola"}),{code:"SALES_MESSAGE_CONFLICT"});
});
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
