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
import { CategoriesService } from "../../src/modules/categories/categories.service.js";
import { PostgresCategoriesRepository } from "../../src/modules/categories/categories.repository.js";

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
    await t.test("leased Typebot turn resolves canonical input only within its business before ACK",async()=>{
      const a=await business(),b=await business();
      const input={contact:"56910000001",messageId:"proof-turn",text:"1000 seguidores",image:false};
      const accepted=await services.inbox.accept(a,input);
      const [claimed]=await services.inbox.claim(a);
      assert.ok(claimed);assert.equal(claimed.id,accepted.id);
      assert.deepEqual(await services.inbox.resolve(a,claimed.id,claimed.lease),input);
      await assert.rejects(()=>services.inbox.resolve(b,claimed.id,claimed.lease),{code:"SALES_TURN_UNAUTHORIZED"});
      await assert.rejects(()=>services.inbox.resolve(a,claimed.id,randomUUID()),{code:"SALES_TURN_UNAUTHORIZED"});
      await services.inbox.finish(a,claimed.id,claimed.lease,"");
      await assert.rejects(()=>services.inbox.resolve(a,claimed.id,claimed.lease),{code:"SALES_TURN_UNAUTHORIZED"});
    });
    await t.test("concurrent outbox claims serialize a recipient until its first delivery is acknowledged",async()=>{
      const a=await business();
      await services.notifications.enqueue(a,"first","whatsapp",{contact:"56910000002",text:"Primero"});
      await services.notifications.enqueue(a,"second","whatsapp",{contact:"56910000002",text:"Segundo"});
      const claims=(await Promise.all([services.notifications.claim(a),services.notifications.claim(a)])).flat();
      assert.equal(claims.length,1);assert.equal(claims[0]!.payload.text,"Primero");
      assert.equal(await services.notifications.finish(a,claims[0]!.id,claims[0]!.lease,true),true);
      const next=await services.notifications.claim(a);
      assert.equal(next.length,1);assert.equal(next[0]!.payload.text,"Segundo");
    });
    const businessA=await business(),businessB=await business();
    const actor=await db.query<{id:string}>("INSERT INTO users(name,email,password_hash) VALUES('Tester',$1,'test-only-not-a-real-password-hash') RETURNING id",[`${randomUUID()}@example.test`]);
    const userId=actor.rows[0]!.id;users.push(userId);
    await db.query("INSERT INTO business_memberships(business_id,user_id,role) VALUES($1,$2,'owner')",[businessA,userId]);
    await services.reviewRepository.setReviewer(businessA,"555",userId);
    const integration=await services.integrations.create(businessA,{providerKey:"test_delivery",credentials:{testOnly:"fixture"}});
    const productResult=await db.query<{id:string}>(`INSERT INTO products(business_id,name,type,status,min_quantity,max_quantity,required_inputs)
      VALUES($1,'Seguidores de Instagram','service','active',1,2000,$2) RETURNING id`,[businessA,JSON.stringify([{key:"targetUrl",label:"Enlace",helpText:null,type:"url",required:true,position:0,validation:{maxLength:2048}}])]);
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

    await t.test("one hour inactivity clears only abandoned context and preserves tenant/history",async()=>{
      const a=await services.access.open(businessA,"56910000333");
      const s=await services.sales.session(businessA,a.sessionId);
      s.state={phase:"quantity",greeted:true,quantity:1000};await services.sales.saveSession(s);
      await services.sales.setTypebotSession(businessA,s.id,"old-typebot");
      assert.equal(await services.sales.closeInactiveSession(businessA,s.id),false);
      await db.query("UPDATE sales_sessions SET updated_at=now()-interval '61 minutes' WHERE id=$1",[s.id]);
      assert.equal(await services.sales.closeInactiveSession(businessB,s.id),false);
      assert.ok((await services.sales.inactiveSessions(businessA)).includes(s.id));
      await services.automation.tick(businessA);
      const fresh=await services.sales.session(businessA,s.id);
      assert.equal(fresh.state.phase,"browse");assert.equal(fresh.state.quantity,undefined);
      assert.equal(fresh.typebotSessionId,null);assert.equal(fresh.customerId,s.customerId);
      assert.equal(await services.sales.closeInactiveSession(businessA,s.id),false);
      // The read-only agent preparation does not set greeted=true. Its retained
      // Typebot session must still expire after one hour without a selection.
      await services.sales.setTypebotSession(businessA,s.id,"idle-agent-typebot");
      await db.query("UPDATE sales_sessions SET updated_at=now()-interval '61 minutes' WHERE id=$1",[s.id]);
      assert.equal(await services.sales.closeInactiveSession(businessA,s.id),true);
      assert.equal((await services.sales.session(businessA,s.id)).typebotSessionId,null);
      fresh.paused=true;fresh.state.phase="inputs";await services.sales.saveSession(fresh);
      await db.query("UPDATE sales_sessions SET updated_at=now()-interval '61 minutes' WHERE id=$1",[s.id]);
      assert.equal(await services.sales.closeInactiveSession(businessA,s.id),false);
    });

    await t.test("natural WhatsApp wording finds the real scoped catalog without a second OpenAI call",async()=>{
      const buyer=await services.access.open(businessA,"56910000000","Comprador semántico");
      const greeting=await services.conversation.receive(businessA,buyer.sessionId,{messageId:"greeting",text:"Hola buenas noches",presentation:"typebot"});
      assert.match(greeting.text,/productos.*soporte/i);
      assert.doesNotMatch(greeting.text,/No encontré|HUMANO/);
      const reply=await services.conversation.receive(businessA,buyer.sessionId,{messageId:"semantic-search",text:"cuánto salen 1000 seguidores de instagram"});
      assert.match(reply.text,/Seguidores de Instagram/);
      assert.match(reply.text,/100 CLP por unidad/);
    });

    await t.test("sessions are scoped, expired tokens and foreign business cannot access them",async()=>{
      assert.equal((await services.access.authenticate(`Bearer ${opened.sessionToken}`)).sessionId,opened.sessionId);
      await services.access.setTypebotSession(`Bearer ${opened.sessionToken}`,"typebot-business-a");
      assert.equal((await services.sales.session(businessA,opened.sessionId)).typebotSessionId,"typebot-business-a");
      const sameContactOtherBusiness=await services.access.open(businessB,"56912345678","Cliente test");
      await services.access.setTypebotSession(`Bearer ${sameContactOtherBusiness.sessionToken}`,"typebot-business-b");
      assert.equal((await services.sales.session(businessB,sameContactOtherBusiness.sessionId)).typebotSessionId,"typebot-business-b");
      assert.equal((await services.sales.session(businessA,opened.sessionId)).typebotSessionId,"typebot-business-a");
      await assert.rejects(()=>services.access.authenticate("Bearer invalid"),{code:"SALES_SESSION_UNAUTHORIZED"});
      await assert.rejects(()=>services.sales.session(businessB,opened.sessionId),{code:"SALES_SESSION_NOT_FOUND"});
      const expired=await services.access.open(businessA,"56911111111");
      await db.query("UPDATE sales_session_tokens SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",[secretHash(expired.sessionToken)]);
      await assert.rejects(()=>services.access.authenticate(`Bearer ${expired.sessionToken}`),{code:"SALES_SESSION_UNAUTHORIZED"});
    });
    await t.test("capture valid delivery data and obtain a quote before any payment or dispatch",async()=>{
      assert.match((await say("catalogo")).text,/Seguidores de Instagram/);
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
      assert.equal(await services.reviewRepository.latestStatus(businessB,review.paymentId,opened.sessionId),null);
      assert.equal(await services.reviewRepository.latestStatus(businessA,review.paymentId,randomUUID()),null);
      assert.match((await say("espero confirmacion de mi comprobante")).text,/Recibimos.*pendiente de revisión/);
      await db.query("UPDATE sales_sessions SET updated_at=now()-interval '61 minutes' WHERE id=$1",[opened.sessionId]);
      assert.equal(await services.sales.closeInactiveSession(businessA,opened.sessionId),false);
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
      const notification=(await db.query("SELECT payload FROM automation_notifications WHERE business_id=$1 AND event_key=$2",[businessA,`review-analysis:${reviewId}`])).rows[0].payload;
      assert.equal(notification.reviewId,reviewId);
      assert.equal(notification.reviewPresentation,"text");
      assert.equal(notification.replyMarkup,undefined,"callback secrets are resolved only at delivery time");
    });
    await t.test("revoked reviewer and expired review cannot approve; requesting information leaves payment pending",async()=>{
      await db.query("UPDATE business_memberships SET role='operator' WHERE business_id=$1 AND user_id=$2",[businessA,userId]);
      await assert.rejects(()=>services.reviews.decide(businessA,"555",callback,"approve","test-ref"),{code:"REVIEWER_NOT_AUTHORIZED"});
      await db.query("UPDATE business_memberships SET role='owner' WHERE business_id=$1 AND user_id=$2",[businessA,userId]);
      await db.query("UPDATE payment_reviews SET expires_at=now()-interval '1 minute' WHERE id=$1",[reviewId]);
      await assert.rejects(()=>services.reviews.decide(businessA,"555",callback,"approve","test-ref"),{code:"REVIEW_EXPIRED"});
      await db.query("UPDATE payment_reviews SET expires_at=now()+interval '1 hour' WHERE id=$1",[reviewId]);
      assert.match((await services.reviews.decide(businessA,"555",callback,"info")).text,/Información adicional solicitada/);
      assert.match((await say("estado del comprobante")).text,/solicitó más información/);
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
      const recovered=(await services.inbox.claim(businessA))[0]!;
      assert.equal(recovered.id,accepted.id);
      await services.inbox.finish(businessA,recovered.id,recovered.lease,"");
    });
    await t.test("an exhausted inbox head remains visible without blocking later messages",async()=>{
      const contact="56933333334";
      const first=await services.inbox.accept(businessA,{contact,messageId:"exhausted-head",text:"malformed historical turn",image:false});
      await services.inbox.accept(businessA,{contact,messageId:"after-exhausted",text:"hola",image:false});
      await db.query("UPDATE sales_inbox SET attempts=8,lease=NULL,lease_until=NULL WHERE id=$1",[first.id]);
      const job=(await services.inbox.claim(businessA))[0];
      assert.equal(job?.payload.messageId,"after-exhausted");
      assert.equal((await services.inboxRepository.failures(businessA)).some(row=>row.id===first.id),true);
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
    await t.test("parent categories are scoped, acyclic and drive progressive generic business navigation",async()=>{
      const a=await business(),b=await business();
      const categories=new CategoriesService(new PostgresCategoriesRepository(db));
      const main=await categories.create(a,{name:"Plataforma de prueba"});
      const child=await categories.create(a,{name:"Seguidores",parentId:main.id});
      await assert.rejects(()=>categories.create(b,{name:"Foreign",parentId:main.id}),{code:"INVALID_CATEGORY_PARENT"});
      await assert.rejects(()=>categories.update(a,main.id,{parentId:child.id}),{code:"INVALID_CATEGORY_PARENT"});
      await assert.rejects(()=>categories.create(a,{name:"Third level",parentId:child.id}),{code:"INVALID_CATEGORY_PARENT"});
      const other=await categories.create(a,{name:"Otra principal"});
      await assert.rejects(()=>categories.update(a,main.id,{parentId:other.id}),{code:"INVALID_CATEGORY_PARENT"});
      for(const quantity of [500,1000,2000,3000,7000,10000]){
        const p=await db.query<{id:string}>(`INSERT INTO products(business_id,category_id,name,type,min_quantity,max_quantity,status,required_inputs)
          VALUES($1,$2,$3,'service',$4,$5,'active',$6) RETURNING id`,[a,child.id,`${quantity} seguidores`,quantity,quantity+50,
          JSON.stringify([{key:"url",label:"Enlace",type:"url",required:true,helpText:null,position:0,validation:{}}])]);
        await db.query("INSERT INTO product_prices(business_id,product_id,pricing_type,currency,fixed_price,status) VALUES($1,$2,'fixed','CLP',4990,'active')",[a,p.rows[0]!.id]);
      }
      const opened=await services.access.open(a,"56910000999");
      let i=0;const say=(text:string)=>services.conversation.receive(a,opened.sessionId,{messageId:`nav-${++i}`,text,presentation:"typebot"});
      assert.match((await say("hola")).text,/Plataforma de prueba/);
      assert.match((await say("Plataforma de prueba")).text,/Seguidores/);
      const catalog=await say("Seguidores");assert.equal(catalog.context?.options.length,6);
      assert.equal(catalog.context?.catalogListing,catalog.text);
      assert.match((await say("5000")).text,/no hay una opción única/);
      assert.match((await say("3000 seguidores esta bien")).text,/Enlace/);
      const chosen=await services.sales.session(a,opened.sessionId);
      assert.equal(chosen.state.quantity,3000);assert.equal(chosen.state.phase,"inputs");
      assert.equal((await db.query("SELECT count(*)::int AS n FROM orders WHERE business_id=$1",[a])).rows[0].n,0);
    });
  });
