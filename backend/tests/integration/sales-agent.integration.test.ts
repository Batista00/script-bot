import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { runner } from "node-pg-migrate";
import { createDatabasePool } from "../../src/core/database/database.js";
import { defaultSalesSettings } from "../../src/modules/sales/sales.types.js";
import type { AgentDecision } from "../../src/modules/sales/sales-agent-actions.js";
import { salesFixture } from "../helpers/sales-fixture.js";
import { PostgresProductsRepository } from "../../src/modules/products/products.repository.js";
import { SalesShippingQuoteService } from "../../src/modules/sales/sales-shipping-quote.service.js";
import { agentDecisionSchema } from "../../src/modules/sales/sales-agent-actions.js";

const testDatabaseUrl=process.env.TEST_DATABASE_URL;
test("Scoped conversational actions and physical checkout",{skip:testDatabaseUrl?false:"TEST_DATABASE_URL is not configured"},async t=>{
  if(!testDatabaseUrl)return;
  await runner({databaseUrl:testDatabaseUrl,direction:"up",dir:"migrations",migrationsTable:"pgmigrations",count:Infinity,log:()=>undefined});
  const db=createDatabasePool(testDatabaseUrl),ids:string[]=[];
  t.after(async()=>{for(const id of ids)await db.query("DELETE FROM businesses WHERE id=$1",[id]);await db.end();});
  let externalOrders=0;
  const services=salesFixture(db,{key:"test_delivery",validateOrder:()=>undefined,
    createOrder:async()=>({providerOrderId:String(++externalOrders)}),
    getOrderStatus:async input=>({providerOrderId:input.providerOrderId,providerStatusRaw:"Completed",status:"completed",charge:null,currency:null,remains:null,startCount:null})});
  async function business(){
    const result=await db.query<{id:string}>("INSERT INTO businesses(name,currency) VALUES($1,'CLP') RETURNING id",[`Agent test ${randomUUID()}`]);
    const id=result.rows[0]!.id;ids.push(id);
    await services.sales.saveSettings(id,{...defaultSalesSettings,enabled:true,autoDispatch:false,telegramChatId:"123456"});
    await db.query(`INSERT INTO business_payment_methods(business_id,type,name,status,config) VALUES($1,'bank_transfer','Transferencia de prueba','active',$2)`,
      [id,JSON.stringify({accountHolder:"Prueba",rut:"12345678-5",bankName:"Test",accountType:"checking",accountNumber:"123"})]);
    return id;
  }
  async function product(businessId:string,physical=false,name?:string){
    const result=await db.query<{id:string}>(`INSERT INTO products(business_id,name,description,type,status,sku,required_inputs,delivery_config)
      VALUES($1,$2,$3,$4,'active',$5,$6,$7) RETURNING id`,[businessId,name??(physical?"Hamburguesa artesanal":"Seguidores de Instagram"),
      physical?"Pan, carne y queso. Consulte alérgenos.":"Paquete sin interacción. Perfil público requerido.",physical?"product":"service",name?null:physical?"FOOD-100%":"SOCIAL-500",
      JSON.stringify(physical?[]:[{key:"targetUrl",label:"Enlace de perfil",helpText:null,type:"url",required:true,position:0,validation:{maxLength:2048}}]),
      physical?JSON.stringify({kind:"physical",methods:["shipping","pickup"],processing:"manual",instructions:"Preparación según disponibilidad.",
        pickupAddress:"Avenida de prueba 123",shipping:{mode:"zones",zones:[{name:"Centro",fee:1500},{name:"Norte",fee:2500}]}}):null]);
    const id=result.rows[0]!.id;
    await db.query("INSERT INTO product_prices(business_id,product_id,pricing_type,currency,unit_price,status) VALUES($1,$2,'unit','CLP',$3,'active')",[businessId,id,physical?3000:100]);
    return id;
  }
  function buyer(businessId:string,sessionId:string){
    let sequence=0;
    return (decision:AgentDecision,text="Mensaje del cliente")=>services.conversation.receive(businessId,sessionId,{messageId:`agent-${++sequence}`,text,presentation:"typebot",decision});
  }
  await t.test("prepare supplies real catalog prices without tools, remains query-only and preserves action replay",async()=>{
    const businessId=await business();
    const instagram=await product(businessId,false,"1000 seguidores Instagram");
    const tiktok=await product(businessId,false,"1000 seguidores TikTok");
    for(const [id,amount] of [[instagram,4990],[tiktok,5990]] as const){
      await db.query("UPDATE products SET min_quantity=1000,max_quantity=1000 WHERE business_id=$1 AND id=$2",[businessId,id]);
      await db.query("UPDATE product_prices SET pricing_type='fixed',unit_price=NULL,fixed_price=$3,min_quantity=1000,max_quantity=1000 WHERE business_id=$1 AND product_id=$2",[businessId,id,amount]);
    }
    const other=await business();await product(other,false,"Seguidores Instagram de otro negocio");
    const {sessionId}=await services.access.open(businessId,"56910000222");
    const questions=["¿Cuánto salen 1000 seguidores de Instagram?","precio de 1000 seguidores instagram",
      "Quiero comprar 1000 seguidores","qué opciones de seguidores de Instagram tienen","muéstrame seguidores de TikTok",
      "seguidores de instagram porfavor"];
    for(const [index,text] of questions.entries()){
      const reply=await services.conversation.prepare(businessId,sessionId,{messageId:`price-${index}:agent:0`,text,presentation:"typebot"});
      assert.match(reply.context!.catalogListing!,text.includes("TikTok")?/5.990 CLP/:/4.990 CLP/);
      assert.doesNotMatch(reply.context!.catalogListing!,/otro negocio/);
      if(text.includes("Instagram")||text.includes("instagram"))assert.doesNotMatch(reply.context!.catalogListing!,/TikTok/);
      if(text.includes("TikTok"))assert.doesNotMatch(reply.context!.catalogListing!,/Instagram/);
      const current=await services.sales.session(businessId,sessionId);
      assert.equal(current.state.phase,"browse");assert.equal(current.state.product,undefined);assert.equal(current.state.checkoutId,undefined);
    }
    for(const table of ["quotes","sales_checkouts","orders","payments","fulfillments"]){
      assert.equal((await db.query(`SELECT 1 FROM ${table} WHERE business_id=$1`,[businessId])).rowCount,0,table);
    }
    for(const text of ["¿Cómo funciona este servicio?","Hola buenas noches"]){
      const before=await services.sales.session(businessId,sessionId);
      const reply=await services.conversation.prepare(businessId,sessionId,{messageId:text,text,presentation:"typebot"});
      assert.equal(reply.context!.catalogListing,null);assert.match(reply.text,/Converse con el cliente/);
      assert.deepEqual((await services.sales.session(businessId,sessionId)).state,before.state);
    }
    const message={messageId:"replay:agent:0",text:questions[0]!,presentation:"typebot" as const};
    const first=await services.conversation.prepare(businessId,sessionId,message);
    assert.deepEqual(await services.conversation.prepare(businessId,sessionId,message),first);
    const action={...message,messageId:"replay:agent:1",decision:{action:"catalog" as const,search:"seguidores instagram"}};
    const tool=await services.conversation.receive(businessId,sessionId,action);
    assert.match(tool.context!.catalogListing!,/4.990 CLP/);assert.deepEqual(await services.conversation.receive(businessId,sessionId,action),tool);
    await services.conversation.receive(businessId,sessionId,{...message,messageId:"replay:agent:2",decision:{action:"select",productId:instagram,quantity:1000}});
    const selected=await services.sales.session(businessId,sessionId);
    assert.equal(selected.state.phase,"inputs");assert.equal(selected.state.input?.targetUrl,undefined);
    assert.deepEqual(await services.conversation.prepare(businessId,sessionId,message),first);
    assert.deepEqual((await services.sales.session(businessId,sessionId)).state,selected.state);
    assert.equal((await db.query("SELECT 1 FROM sales_messages WHERE business_id=$1 AND session_id=$2 AND message_id=$3",[businessId,sessionId,message.messageId])).rowCount,1);
    await assert.rejects(()=>services.conversation.prepare(businessId,sessionId,{...message,text:"hola"}),{code:"SALES_MESSAGE_CONFLICT"});
    assert.equal(externalOrders,0);
  });
  await t.test("FAQs preserve selection, photo requests URL, summary includes description, payment needs real order",async()=>{
    const businessId=await business(),productId=await product(businessId);
    const {sessionId}=await services.access.open(businessId,"56910000077");const send=buyer(businessId,sessionId);
    await send({action:"catalog",search:"seguidores instagram"});
    const before=await services.sales.session(businessId,sessionId);
    const faq=await services.conversation.prepare(businessId,sessionId);
    assert.deepEqual((await services.sales.session(businessId,sessionId)).state,before.state);
    assert.ok(faq.context?.products.some(p=>p.productId===productId));
    await send({action:"select",productId,quantity:10},"sí esos");
    assert.equal((await services.sales.session(businessId,sessionId)).state.phase,"inputs");
    assert.match((await send({action:"confirm"})).text,/todavía no corresponde/);
    const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString("base64");
    const photo=await services.reviews.submit(businessId,sessionId,{mimeType:"image/png",base64:png});
    assert.equal(photo.reviewId,null);assert.match(photo.text,/enlace|URL/i);
    const summary=await send({action:"input",value:"https://example.com/soporte"});
    assert.match(summary.text,/Paquete sin interacción/);assert.match(summary.text,/1.000 CLP/);
    assert.equal((await services.sales.session(businessId,sessionId)).paused,false,"an explicit input URL is data, not a support command");
    await services.conversation.prepare(businessId,sessionId);
    assert.equal((await services.sales.session(businessId,sessionId)).state.phase,"confirm");
    const confirmation=await send({action:"confirm"});
    assert.ok(confirmation.context&&"paymentMethods" in confirmation.context);
    const context=await services.conversation.prepare(businessId,sessionId);
    assert.ok(context.context&&"paymentMethods" in context.context);
    assert.ok(Array.isArray(context.context.paymentMethods));
    await send({action:"payment",methodId:context.context.paymentMethods[0]!.methodId},"transferencia por favor");
    assert.equal((await services.sales.session(businessId,sessionId)).state.phase,"awaiting");
    assert.equal(externalOrders,0);
    const pending=await services.checkout.ownedCheckout(await services.sales.session(businessId,sessionId));
    assert.equal((await services.gateway.getPayment(businessId,pending.paymentId!)).status,"pending");
    assert.match((await send({action:"new_purchase"})).text,/agente|revisión/);
    await db.query("UPDATE sales_sessions SET updated_at=now()-interval '61 minutes' WHERE id=$1",[sessionId]);
    await services.automation.tick(businessId);
    assert.equal((await services.sales.session(businessId,sessionId)).state.phase,"browse");
    assert.doesNotMatch((await send({action:"new_purchase"},"quiero otra compra")).text,/debe gestionar|antes de reemplazar/);
    await send({action:"catalog",search:"seguidores instagram"});
    await send({action:"select",productId,quantity:20});
    await send({action:"input",value:"https://example.com/otro-perfil"});
    await send({action:"confirm"});
    const next=await services.checkout.ownedCheckout(await services.sales.session(businessId,sessionId));
    assert.notEqual(next.orderId,pending.orderId);
    assert.equal((await services.gateway.getPayment(businessId,pending.paymentId!)).status,"pending");
    assert.equal((await services.gateway.getOrder(businessId,pending.orderId!)).status,"pending_payment");
  });
  await t.test("physical zone fee is snapshotted in quote, order and payment; pickup is free",async()=>{
    const businessId=await business(),productId=await product(businessId,true);
    const {sessionId}=await services.access.open(businessId,"56910000088");const send=buyer(businessId,sessionId);
    await send({action:"catalog",search:"hamburguesa"});await send({action:"select",productId,quantity:2});
    assert.equal((await services.sales.session(businessId,sessionId)).state.phase,"delivery");
    await assert.rejects(()=>services.gateway.createQuote(businessId,{productId,quantity:2}),{code:"DELIVERY_SELECTION_REQUIRED"});
    const summary=await send({action:"delivery",selection:{method:"shipping",address:"Calle de prueba 456",zone:"Centro"}});
    assert.match(summary.text,/Pan, carne y queso/);assert.match(summary.text,/7.500 CLP/);assert.match(summary.text,/1.500 CLP/);
    await send({action:"confirm"});
    const checkout=await services.checkout.ownedCheckout(await services.sales.session(businessId,sessionId));
    const order=await services.gateway.getOrder(businessId,checkout.orderId!);
    assert.equal(order.subtotal,6000);assert.equal(order.total,7500);assert.equal(order.items[0]!.totalPrice,6000);
    assert.deepEqual(order.delivery,checkout.delivery.physical);
    const methods=await services.gateway.listPaymentMethods(businessId);
    await send({action:"payment",methodId:methods[0]!.paymentMethodId});
    const payment=(await db.query<{amount:string}>("SELECT amount FROM payments WHERE business_id=$1 AND order_id=$2",[businessId,order.orderId])).rows[0]!;
    assert.equal(Number(payment.amount),7500);
    const pickup=await services.gateway.createQuote(businessId,{productId,quantity:1,delivery:{method:"pickup"}});
    assert.equal(pickup.totalPrice,3000);assert.equal(pickup.delivery?.fee,0);assert.equal(pickup.delivery?.address,"Avenida de prueba 123");
    await services.automation.tick(businessId);assert.equal(externalOrders,0);
  });
  await t.test("search is scoped, escapes wildcards, and configuration changes block an old delivery",async()=>{
    const a=await business(),b=await business(),p=await product(a,true);await product(b,true);
    const repository=new PostgresProductsRepository(db);
    assert.equal((await repository.list(a,{limit:25,offset:0,search:"food-100%"})).length,1);
    assert.equal((await repository.list(a,{limit:25,offset:0,search:"%"})).length,1);
    assert.equal((await repository.list(a,{limit:25,offset:0,search:"_"})).length,0);
    const snapshot=await services.delivery.validate(a,p,1,{}, {method:"pickup"});
    await db.query(`UPDATE products SET delivery_config=jsonb_set(delivery_config,'{pickupAddress}','"Nueva dirección 789"') WHERE business_id=$1 AND id=$2`,[a,p]);
    await assert.rejects(()=>services.delivery.revalidate(a,1,snapshot),{code:"DELIVERY_CONFIGURATION_CHANGED"});
    await assert.rejects(()=>services.gateway.createQuote(b,{productId:p,quantity:1,delivery:{method:"pickup"}}),{code:"PRODUCT_NOT_AVAILABLE"});
  });
  await t.test("staff quotes delivery once, records its actor and asks the customer to confirm before paying",async()=>{
    const businessId=await business(),productId=await product(businessId,true),actor=randomUUID();
    await db.query(`UPDATE products SET delivery_config=jsonb_set(delivery_config,'{shipping}','{"mode":"quote"}') WHERE business_id=$1 AND id=$2`,[businessId,productId]);
    const {sessionId}=await services.access.open(businessId,"56910000111"),send=buyer(businessId,sessionId);
    await send({action:"catalog",search:"hamburguesa"});await send({action:"select",productId,quantity:2});
    const blocked=await send({action:"delivery",selection:{method:"shipping",address:"Calle de prueba 555"}});
    assert.match(blocked.text,/cotizar/);assert.equal((await services.sales.session(businessId,sessionId)).state.phase,"delivery");
    assert.equal(agentDecisionSchema.safeParse({action:"delivery",selection:{method:"shipping",address:"Calle de prueba 555",fee:0}}).success,false);
    const shipping=new SalesShippingQuoteService(services.sales,services.checkout,services.notifications);
    const request={requestId:randomUUID(),fee:1800,address:"Calle de prueba 555"};
    const response=await shipping.quote(businessId,sessionId,actor,request);
    assert.match(response.text,/7.800 CLP/);assert.deepEqual(await shipping.quote(businessId,sessionId,actor,request),response);
    assert.equal((await db.query("SELECT 1 FROM sales_checkouts WHERE business_id=$1",[businessId])).rowCount,1);
    assert.equal((await db.query("SELECT 1 FROM payments WHERE business_id=$1",[businessId])).rowCount,0);
    await assert.rejects(()=>shipping.quote(businessId,sessionId,actor,{...request,fee:0}),{code:"SALES_MESSAGE_CONFLICT"});
    await send({action:"confirm"});
    const checkout=await services.checkout.ownedCheckout(await services.sales.session(businessId,sessionId));
    const order=await services.gateway.getOrder(businessId,checkout.orderId!);
    assert.equal(order.total,7800);assert.equal(order.delivery?.manualQuote?.quotedBy,actor);
    const methods=await services.gateway.listPaymentMethods(businessId);await send({action:"payment",methodId:methods[0]!.paymentMethodId});
    assert.equal((await services.sales.session(businessId,sessionId)).state.phase,"awaiting");
  });
  await t.test("private downloads and licenses reserve once, require payment and finish only after delivery ACK",async()=>{
    const businessId=await business(),otherBusiness=await business(),productId=await product(businessId,false,"Curso digital");
    await db.query(`UPDATE products SET type='product',required_inputs='[]',delivery_config=$3 WHERE business_id=$1 AND id=$2`,
      [businessId,productId,JSON.stringify({kind:"digital",methods:["digital"],processing:"automatic",digitalContents:"both",instructions:"Acceso después del pago."})]);
    const download="https://example.com/private-test-download",license="TEST-LICENSE-DO-NOT-USE";
    await services.digital.add(businessId,productId,{kind:"download",label:"Curso",value:download});
    const asset=await services.digital.add(businessId,productId,{kind:"license",label:"Activación",value:license});
    await assert.rejects(()=>services.digital.add(businessId,productId,{kind:"license",label:"Duplicado",value:license}),{code:"DIGITAL_ASSET_DUPLICATE"});
    await assert.rejects(()=>services.digital.list(otherBusiness,productId));
    const stored=await db.query("SELECT value_encrypted FROM product_digital_assets WHERE business_id=$1",[businessId]);
    assert.ok(!JSON.stringify(stored.rows).includes(license));assert.ok(!JSON.stringify(stored.rows).includes(download));
    assert.ok(!JSON.stringify(await services.digital.list(businessId,productId)).includes(license));
    const {sessionId}=await services.access.open(businessId,"56910000101"),send=buyer(businessId,sessionId);
    await send({action:"catalog",search:"curso"});const summary=await send({action:"select",productId,quantity:1});
    assert.ok(!JSON.stringify(summary).includes(license));assert.ok(!JSON.stringify(summary).includes(download));
    await send({action:"confirm"});
    const checkout=await services.checkout.ownedCheckout(await services.sales.session(businessId,sessionId));
    const allocation=await services.digital.reserve(businessId,checkout.orderId!);
    assert.equal((await services.digital.reserve(businessId,checkout.orderId!)).id,allocation.id);
    await assert.rejects(()=>services.digital.content(businessId,allocation.id),{code:"DIGITAL_PAYMENT_REQUIRED"});
    await assert.rejects(()=>services.digital.enqueue(businessId,checkout.orderId!,"56910000101"),{code:"DIGITAL_PAYMENT_REQUIRED"});
    await assert.rejects(()=>services.digital.status(businessId,productId,asset.id,"inactive"),{code:"DIGITAL_ASSET_NOT_EDITABLE"});
    await assert.rejects(()=>services.delivery.validate(businessId,productId,1,{}),{code:"DIGITAL_ASSETS_UNAVAILABLE"});
    const secondQuote=await services.gateway.createQuote(businessId,{productId,quantity:1});
    const secondOrder=await services.gateway.createOrder(businessId,{quoteId:secondQuote.quoteId,customerId:(await services.sales.session(businessId,sessionId)).customerId});
    await assert.rejects(()=>services.digital.reserve(businessId,secondOrder.orderId),{code:"DIGITAL_ASSETS_UNAVAILABLE"});
    const methods=await services.gateway.listPaymentMethods(businessId);await send({action:"payment",methodId:methods[0]!.paymentMethodId});
    const paidCheckout=await services.checkout.ownedCheckout(await services.sales.session(businessId,sessionId));
    assert.ok(paidCheckout.paymentId,"reserved stock must not block its owning checkout");
    await services.payments.confirmBankTransfer(businessId,paidCheckout.paymentId!,"test-only-digital-payment");
    await services.automation.tick(businessId);await services.automation.tick(businessId);
    const queued=(await db.query("SELECT payload FROM automation_notifications WHERE business_id=$1",[businessId])).rows;
    assert.ok(!JSON.stringify(queued).includes(license));assert.ok(!JSON.stringify(queued).includes(download));
    assert.equal((await services.gateway.getOrder(businessId,checkout.orderId!)).status,"paid");
    let digitalMessages=0;
    for(let pass=0;pass<5;pass++){
      for(const job of await services.automation.claim(businessId)){
        if(job.payload.digitalDeliveryId){digitalMessages++;assert.match(String(job.payload.text),/TEST-LICENSE-DO-NOT-USE/);assert.ok(String(job.payload.text).includes(download));}
        await services.notifications.finish(businessId,job.id,job.lease,true);
      }
      await services.automation.tick(businessId);
    }
    assert.equal(digitalMessages,1);assert.equal((await services.gateway.getOrder(businessId,checkout.orderId!)).status,"completed");
    await assert.rejects(()=>services.digital.content(otherBusiness,allocation.id),{code:"DIGITAL_PAYMENT_REQUIRED"});
    assert.equal((await db.query("SELECT 1 FROM digital_order_deliveries WHERE business_id=$1",[businessId])).rowCount,1);
  });
  await t.test("two SMM products become one paid order; each item dispatches once and completion waits for all",async()=>{
    const businessId=await business(),followers=await product(businessId),likes=await product(businessId,false,"Likes de Instagram");
    const integration=await services.integrations.create(businessId,{providerKey:"test_delivery",credentials:{testOnly:"fixture"}});
    for(const productId of [followers,likes]){
      const row=await db.query<{id:string}>(`INSERT INTO provider_services(business_id,integration_id,provider_key,external_service_id,name,service_type,min_quantity,max_quantity,provider_status,last_synced_at,order_capabilities)
        VALUES($1,$2,'test_delivery',$3,'Fixture','Default',1,100,'active',now(),$4) RETURNING id`,[businessId,integration.id,productId,JSON.stringify({supported:true,required:[],optional:[]})]);
      await db.query("INSERT INTO product_provider_mappings(business_id,product_id,provider_service_id,status) VALUES($1,$2,$3,'active')",[businessId,productId,row.rows[0]!.id]);
    }
    const {sessionId}=await services.access.open(businessId,"56910000099"),send=buyer(businessId,sessionId);
    await send({action:"catalog",search:"seguidores"});await send({action:"select",productId:followers,quantity:10});
    await send({action:"input",value:"https://example.com/profile"});
    await send({action:"add_item"},"También quiero likes antes de pagar");
    await send({action:"catalog",search:"likes"});await send({action:"select",productId:likes,quantity:20});
    const summary=await send({action:"input",value:"https://example.com/post"});
    assert.match(summary.text,/Seguidores de Instagram/);assert.match(summary.text,/Likes de Instagram/);assert.match(summary.text,/3.000 CLP/);
    await send({action:"confirm"});
    const checkout=await services.checkout.ownedCheckout(await services.sales.session(businessId,sessionId));
    const order=await services.gateway.getOrder(businessId,checkout.orderId!);
    assert.equal(order.items.length,2);assert.equal(order.total,3000);assert.equal(order.subtotal,3000);
    assert.equal((await db.query("SELECT 1 FROM orders WHERE business_id=$1",[businessId])).rowCount,1);
    const methods=await services.gateway.listPaymentMethods(businessId);await send({action:"payment",methodId:methods[0]!.paymentMethodId});
    const paidCheckout=await services.checkout.ownedCheckout(await services.sales.session(businessId,sessionId));
    assert.equal(externalOrders,0);await services.payments.confirmBankTransfer(businessId,paidCheckout.paymentId!,"test-only-cart-payment");
    const first=order.items[0]!,snapshot=checkout.delivery.items!.find(item=>item.productId===first.productId)!;
    const submitted=await services.gateway.dispatchFulfillment(businessId,order.orderId,{orderItemId:first.orderItemId,input:snapshot.input},snapshot.providerServiceId!);
    await services.gateway.syncFulfillment(businessId,submitted.fulfillmentId);
    assert.equal((await services.gateway.getOrder(businessId,order.orderId)).status,"processing","one completed item cannot complete the entire cart");
    await services.sales.saveSettings(businessId,{...(await services.sales.settings(businessId)),autoDispatch:true});
    await services.automation.tick(businessId);await services.automation.tick(businessId);
    assert.equal(externalOrders,2);assert.equal((await services.gateway.getOrder(businessId,order.orderId)).status,"completed");
    await send({action:"new_purchase"},"Quiero comprar nuevamente");
    const fresh=await services.sales.session(businessId,sessionId);assert.equal(fresh.state.cart,undefined);assert.equal(fresh.state.phase,"browse");
    assert.equal((await services.gateway.getOrder(businessId,order.orderId)).total,3000);
  });
});
