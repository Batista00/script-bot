import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { runner } from "node-pg-migrate";
import { createDatabasePool } from "../../src/core/database/database.js";
import { defaultSalesSettings } from "../../src/modules/sales/sales.types.js";
import { salesFixture } from "../helpers/sales-fixture.js";
import { SalesConversationService } from "../../src/modules/sales/sales-conversation.service.js";
import { TelegramService } from "../../src/integrations/telegram/telegram.service.js";
import { secretHash } from "../../src/modules/sales/sales-access.service.js";
import { AppError } from "../../src/core/errors/app-error.js";

const testDatabaseUrl=process.env.TEST_DATABASE_URL;
test("Durable multi-business sales, manual payment review and delivery against PostgreSQL",
  {skip:testDatabaseUrl?false:"TEST_DATABASE_URL is not configured"},async(t)=>{
    if(!testDatabaseUrl)return;
    await runner({databaseUrl:testDatabaseUrl,direction:"up",dir:"migrations",migrationsTable:"pgmigrations",count:Infinity,log:()=>undefined});
    const db=createDatabasePool(testDatabaseUrl);
    const ids:string[]=[],users:string[]=[];
    t.after(async()=>{for(const id of ids)await db.query("DELETE FROM businesses WHERE id=$1",[id]);for(const id of users)await db.query("DELETE FROM users WHERE id=$1",[id]);await db.end();});
    let externalOrders=0;
    const services=salesFixture(db,{key:"test_delivery",validateOrder:()=>undefined,
      createOrder:async()=>({providerOrderId:String(++externalOrders)}),
      getOrderStatus:async(input)=>({providerOrderId:input.providerOrderId,providerStatusRaw:"Completed",status:"completed",charge:null,currency:null,remains:null,startCount:null})});
    async function business(){
      const result=await db.query<{id:string}>("INSERT INTO businesses(name,currency) VALUES($1,'CLP') RETURNING id",[`Sales test ${randomUUID()}`]);
      const id=result.rows[0]!.id;ids.push(id);
      await services.sales.saveSettings(id,{...defaultSalesSettings,enabled:true,autoDispatch:true,telegramChatId:"123456",humanContact:"Equipo de prueba"});
      return id;
    }
    const businessA=await business(),businessB=await business();
    const actor=await db.query<{id:string}>("INSERT INTO users(name,email,password_hash) VALUES('Tester',$1,'test-only-not-a-real-password-hash') RETURNING id",[`${randomUUID()}@example.test`]);
    const userId=actor.rows[0]!.id;users.push(userId);
    await db.query("INSERT INTO business_memberships(business_id,user_id,role) VALUES($1,$2,'owner')",[businessA,userId]);
    await services.reviewRepository.setReviewer(businessA,"555",userId);
    const integration=await services.integrations.create(businessA,{providerKey:"test_delivery",credentials:{testOnly:"fixture"}});
    const productResult=await db.query<{id:string}>(`INSERT INTO products(business_id,name,type,status,min_quantity,max_quantity,required_inputs)
      VALUES($1,'Producto de prueba','service','active',1,20,$2) RETURNING id`,[businessA,JSON.stringify([{key:"targetUrl",label:"Enlace",helpText:null,type:"url",required:true,position:0,validation:{maxLength:2048}}])]);
    const productId=productResult.rows[0]!.id;
    await db.query("INSERT INTO product_prices(business_id,product_id,pricing_type,currency,unit_price,min_quantity,max_quantity,status) VALUES($1,$2,'unit','CLP',100,1,20,'active')",[businessA,productId]);
    const provider=await db.query<{id:string}>(`INSERT INTO provider_services(business_id,integration_id,provider_key,external_service_id,name,service_type,min_quantity,max_quantity,provider_status,last_synced_at,order_capabilities)
      VALUES($1,$2,'test_delivery','fixture-service','Fixture','Default',1,20,'active',now(),$3) RETURNING id`,[businessA,integration.id,JSON.stringify({supported:true,required:[],optional:[]})]);
    await db.query("INSERT INTO product_provider_mappings(business_id,product_id,provider_service_id,status) VALUES($1,$2,$3,'active')",[businessA,productId,provider.rows[0]!.id]);
    await db.query(`INSERT INTO business_payment_methods(business_id,type,name,status,config) VALUES($1,'bank_transfer','Banco test','active',$2)`,
      [businessA,JSON.stringify({accountHolder:"Prueba",rut:"12345678-5",bankName:"Test",accountType:"checking",accountNumber:"123"})]);
    const opened=await services.access.open(businessA,"56912345678","Cliente test");
    let messageIndex=0;
    const say=(text:string,id=`message-${++messageIndex}`)=>services.conversation.receive(businessA,opened.sessionId,{messageId:id,text});

    await t.test("natural language searches the scoped catalog through the existing AI interpreter",async()=>{
      const semantic=new SalesConversationService(services.sales,services.gateway,services.checkout,services.notifications,{
        isConfigured:()=>true,
        interpret:async()=>({intent:"buy_product",confidence:0.99,entities:{platform:null,service:null,
          quantity:null,urls:[],paymentMethod:null,searchTerms:["producto","prueba"]}}),
      });
      const buyer=await services.access.open(businessA,"56910000000","Comprador semántico");
      const reply=await semantic.receive(businessA,buyer.sessionId,{messageId:"semantic-search",text:"busco el producto de prueba"});
      assert.match(reply.text,/Producto de prueba/);
      assert.match(reply.text,/100 CLP por unidad/);
    });

    await t.test("sessions are scoped, expired tokens and foreign business cannot access them",async()=>{
      assert.equal((await services.access.authenticate(`Bearer ${opened.sessionToken}`)).sessionId,opened.sessionId);
      await assert.rejects(()=>services.access.authenticate("Bearer invalid"),{code:"SALES_SESSION_UNAUTHORIZED"});
      await assert.rejects(()=>services.sales.session(businessB,opened.sessionId),{code:"SALES_SESSION_NOT_FOUND"});
      const expired=await services.access.open(businessA,"56911111111");
      await db.query("UPDATE sales_session_tokens SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",[secretHash(expired.sessionToken)]);
      await assert.rejects(()=>services.access.authenticate(`Bearer ${expired.sessionToken}`),{code:"SALES_SESSION_UNAUTHORIZED"});
    });
    await t.test("capture valid delivery data and obtain a quote before any payment or dispatch",async()=>{
      assert.match((await say("catalogo")).text,/Producto de prueba/);
      await say("1");await say("2");
      assert.match((await say("not-a-url")).text,/Revisa/);
      assert.equal(externalOrders,0);
      assert.match((await say("https://example.com/post")).text,/200 CLP/);
      const session=await services.sales.session(businessA,opened.sessionId);
      const checkout=await services.checkout.ownedCheckout(session);
      assert.equal(checkout.orderId,null);assert.equal(checkout.delivery.input.targetUrl,"https://example.com/post");
      assert.equal((await db.query("SELECT 1 FROM payments WHERE business_id=$1",[businessA])).rowCount,0);
    });
    await t.test("confirmation and duplicate message survive service reconstruction without duplicate order",async()=>{
      const first=await say("Sí, están bien","confirmation");
      const restarted=new SalesConversationService(services.sales,services.gateway,services.checkout,services.notifications);
      const second=await restarted.receive(businessA,opened.sessionId,{messageId:"confirmation",text:"Sí, están bien"});
      assert.deepEqual(first,second);
      await assert.rejects(()=>say("CANCELAR","confirmation"),{code:"SALES_MESSAGE_CONFLICT"});
      assert.equal((await db.query("SELECT 1 FROM orders WHERE business_id=$1",[businessA])).rowCount,1);
      await say("transferencia bancaria");await services.automation.tick(businessA);assert.equal(externalOrders,0);
    });
    await t.test("returning to catalog preserves the order and its evidence destination",async()=>{
      const before=await services.checkout.ownedCheckout(await services.sales.session(businessA,opened.sessionId));
      await say("catalogo");
      assert.match((await say("estado")).text,/pendiente de pago/);
      const after=await services.checkout.ownedCheckout(await services.sales.session(businessA,opened.sessionId));
      assert.equal(after.id,before.id);
    });
    let reviewId="",callback="";
    await t.test("evidence is encrypted and does not approve payment",async()=>{
      const png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII=";
      const first=await services.reviews.submit(businessA,opened.sessionId,{mimeType:"image/png",base64:png});assert.ok(first.reviewId);reviewId=first.reviewId;
      const second=await services.reviews.submit(businessA,opened.sessionId,{mimeType:"image/png",base64:png});assert.equal(second.reviewId,reviewId);
      const review=(await services.reviewRepository.find(businessA,reviewId))!;
      assert.ok(!review.evidenceEncrypted!.includes(png));assert.equal((await services.payments.getById(businessA,review.paymentId)).status,"pending");
      const notification=await services.reviews.notification(businessA,reviewId);
      callback=notification.replyMarkup.inline_keyboard[0]![0]!.callback_data.split(":")[1]!;
      await assert.rejects(()=>services.reviews.decide(businessB,"555",callback,"approve","test-bank-ref"),{code:"REVIEWER_NOT_AUTHORIZED"});
      await assert.rejects(()=>services.reviews.decide(businessA,"999",callback,"approve","test-bank-ref"),{code:"REVIEWER_NOT_AUTHORIZED"});
      assert.match((await services.reviews.decide(businessA,"555",callback,"approve")).text,/REFERENCIA_BANCARIA/);
      assert.equal((await services.payments.getById(businessA,review.paymentId)).status,"pending");
    });
    await t.test("OCR observations are scoped, encrypted and cannot approve the payment",async()=>{
      const analysis={amount:"999",currency:"CLP",recipient:null,bankReference:null,observations:"Fixture only"};
      await assert.rejects(()=>services.reviews.annotate(businessB,opened.sessionId,reviewId,analysis),{code:"REVIEW_NOT_FOUND"});
      await services.reviews.annotate(businessA,opened.sessionId,reviewId,analysis);
      const review=(await services.reviewRepository.find(businessA,reviewId))!;
      assert.equal((await services.payments.getById(businessA,review.paymentId)).status,"pending");
      assert.ok(!review.evidenceEncrypted!.includes("Fixture only"));
    });
    await t.test("revoked reviewer and expired review cannot approve; requesting information leaves payment pending",async()=>{
      await db.query("UPDATE business_memberships SET role='operator' WHERE business_id=$1 AND user_id=$2",[businessA,userId]);
      await assert.rejects(()=>services.reviews.decide(businessA,"555",callback,"approve","test-ref"),{code:"REVIEWER_NOT_AUTHORIZED"});
      await db.query("UPDATE business_memberships SET role='owner' WHERE business_id=$1 AND user_id=$2",[businessA,userId]);
      await db.query("UPDATE payment_reviews SET expires_at=now()-interval '1 minute' WHERE id=$1",[reviewId]);
      await assert.rejects(()=>services.reviews.decide(businessA,"555",callback,"approve","test-ref"),{code:"REVIEW_EXPIRED"});
      await db.query("UPDATE payment_reviews SET expires_at=now()+interval '1 hour' WHERE id=$1",[reviewId]);
      await services.reviews.decide(businessA,"555",callback,"info");
      const review=(await services.reviewRepository.find(businessA,reviewId))!;
      assert.equal(review.status,"more_info");
      assert.equal((await services.payments.getById(businessA,review.paymentId)).status,"pending");
    });
    await t.test("a definite payment rejection permits correcting the human bank reference",async()=>{
      const confirm=services.payments.confirmBankTransfer.bind(services.payments);
      services.payments.confirmBankTransfer=async()=>{throw new AppError("Reference already used",409,"PAYMENT_PROVIDER_ID_CONFLICT");};
      try { await assert.rejects(()=>services.reviews.decide(businessA,"555",callback,"approve","bad-reference"),{code:"PAYMENT_PROVIDER_ID_CONFLICT"}); }
      finally { services.payments.confirmBankTransfer=confirm; }
      const review=(await services.reviewRepository.find(businessA,reviewId))!;
      assert.equal(review.status,"pending");assert.equal(review.reference,null);
      assert.equal((await services.payments.getById(businessA,review.paymentId)).status,"pending");
    });
    await t.test("human approval is audited and restart after payment commit does not duplicate delivery",async()=>{
      await services.reviews.decide(businessA,"555",callback,"approve","bank-reference-test-001");
      // Simulate loss of the process after Payment commit but before marking review approved.
      await db.query("UPDATE payment_reviews SET status='approving' WHERE id=$1",[reviewId]);
      await services.reviews.decide(businessA,"555",callback,"approve","bank-reference-test-001");
      const review=(await services.reviewRepository.find(businessA,reviewId))!;
      assert.equal(review.status,"approved");assert.equal(review.reviewerId,userId);
      assert.equal((await services.payments.getById(businessA,review.paymentId)).status,"approved");
      await db.query("UPDATE sales_checkouts SET next_check_at=now() WHERE business_id=$1",[businessA]);
      await services.automation.tick(businessA);await services.automation.tick(businessA);
      assert.equal(externalOrders,1);
      const checkout=await services.checkout.ownedCheckout(await services.sales.session(businessA,opened.sessionId));
      assert.equal((await services.gateway.getOrder(businessA,checkout.orderId!)).status,"completed");
      const delivered=await db.query<{text:string}>(`SELECT payload->>'text' AS text FROM automation_notifications
        WHERE business_id=$1 AND channel='whatsapp' AND payload->>'text' LIKE '%Referencia del proveedor:%'`,[businessA]);
      assert.match(delivered.rows[0]?.text ?? "",/Referencia del proveedor: 1/);
    });
    await t.test("notifications leases prevent concurrent claims and cross-business acknowledgements",async()=>{
      const [left,right]=await Promise.all([services.notifications.claim(businessA),services.notifications.claim(businessA)]);
      assert.equal(new Set([...left,...right].map(j=>j.id)).size,left.length+right.length);
      const job=[...left,...right][0]!;assert.ok(job);
      assert.equal(await services.notifications.finish(businessB,job.id,job.lease,true),false);
      assert.equal(await services.notifications.finish(businessA,job.id,randomUUID(),true),false);
      assert.equal(await services.notifications.finish(businessA,job.id,job.lease,true),true);
      assert.equal(await services.notifications.finish(businessA,job.id,job.lease,true),false);
    });
    await t.test("inbox deduplication, ordering and durable outgoing reply",async()=>{
      const input={contact:"56922222222",messageId:"one",text:"hola",image:false};
      assert.equal((await services.inbox.accept(businessA,input)).id,(await services.inbox.accept(businessA,input)).id);
      await services.inbox.accept(businessA,{...input,messageId:"two"});
      const jobs=await services.inbox.claim(businessA);assert.equal(jobs.length,1);assert.equal(jobs[0]!.payload.messageId,"one");
      assert.equal((await services.inbox.claim(businessA)).length,0);
      await services.inbox.finish(businessA,jobs[0]!.id,jobs[0]!.lease,"Respuesta guardada");
      assert.equal((await services.inbox.claim(businessA))[0]!.payload.messageId,"two");
    });
    await t.test("exhausted inbox jobs can be recovered only in their own business",async()=>{
      const input={contact:"56933333333",messageId:"recover",text:"hola",image:false};
      const accepted=await services.inbox.accept(businessA,input);
      await db.query("UPDATE sales_inbox SET attempts=8,lease_until=NULL WHERE id=$1",[accepted.id]);
      assert.equal((await services.inboxRepository.failures(businessA)).length,1);
      assert.equal(await services.inboxRepository.retryFailed(businessB,accepted.id),false);
      assert.equal(await services.inboxRepository.retryFailed(businessA,accepted.id),true);
      assert.equal((await services.inboxRepository.failures(businessA)).length,0);
    });
    await t.test("opt-out suppresses queued WhatsApp messages and human handoff requires admin resume",async()=>{
      await say("baja");
      assert.equal((await services.sales.session(businessA,opened.sessionId)).state.optedOut,true);
      assert.equal((await say("hola")).text,"");
      const pending=await db.query("SELECT 1 FROM automation_notifications WHERE business_id=$1 AND channel='whatsapp' AND payload->>'contact'=$2 AND delivered_at IS NULL",[businessA,"56912345678"]);
      assert.equal(pending.rowCount,0);
      await say("alta");await say("humano");
      assert.equal((await say("hola")).text,"");
      assert.equal((await services.sales.session(businessA,opened.sessionId)).paused,true);
    });
    await t.test("manual products require a paid order and explicit audited human delivery",async()=>{
      const product=await db.query<{id:string}>("INSERT INTO products(business_id,name,type,status) VALUES($1,'Manual fixture','product','active') RETURNING id",[businessB]);
      const id=product.rows[0]!.id;
      await db.query("INSERT INTO product_prices(business_id,product_id,pricing_type,currency,fixed_price,status) VALUES($1,$2,'fixed','CLP',100,'active')",[businessB,id]);
      const openedManual=await services.access.open(businessB,"56944444444");
      const session=await services.sales.session(businessB,openedManual.sessionId);
      session.state={product:await services.gateway.getProduct(businessB,id),quantity:1};
      await services.checkout.quote(session);await services.sales.saveSession(session);
      await services.checkout.confirm(session);await services.sales.saveSession(session);
      const checkout=await services.checkout.ownedCheckout(session);
      await assert.rejects(()=>services.sales.completeManual(businessB,checkout.id,userId,"fixture"),{code:"ORDER_NOT_READY_FOR_FULFILLMENT"});
      const {payment}=await services.gateway.createPayment(businessB,checkout.orderId!,{providerKey:"bank_transfer"},"manual-fixture-payment");
      await services.payments.confirmBankTransfer(businessB,payment.paymentId,"manual-fixture-reference");
      await services.sales.completeManual(businessB,checkout.id,userId,"Entregado en prueba local");
      await services.sales.completeManual(businessB,checkout.id,userId,"Repetición");
      assert.equal((await services.gateway.getOrder(businessB,checkout.orderId!)).status,"completed");
      assert.equal((await db.query("SELECT 1 FROM sales_manual_deliveries WHERE business_id=$1 AND checkout_id=$2",[businessB,checkout.id])).rowCount,1);
      assert.equal(externalOrders,1);
    });
    await t.test("Telegram rejects spoofed secret before human authorization or network",async()=>{
      const telegram=await services.integrations.create(businessA,{providerKey:"telegram",credentials:{webhookSecret:"t".repeat(32),botToken:"123:fixture"}});
      const service=new TelegramService(services.integrations,services.reviews,services.sales,async()=>{throw new Error("Network must not run");});
      await assert.rejects(()=>service.receive(telegram.id,"wrong",{}),{code:"TELEGRAM_WEBHOOK_UNAUTHORIZED"});
      assert.deepEqual(await service.receive(telegram.id,"t".repeat(32),{message:{chat:{id:999},from:{id:555},text:"/abono anything"}}),{ok:true});
    });
  });
