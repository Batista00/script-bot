import assert from "node:assert/strict";
import {test} from "node:test";
import {typebot} from "../scripts/build-typebot.mjs";
import {bridge} from "../scripts/build-bridge.mjs";
import {notifications} from "../scripts/build-notifications.mjs";
import {salesWorker} from "../scripts/build-sales-worker.mjs";
import {typebotEnvelope} from "../scripts/typebot-session.mjs";
import {encodeOutboxMessages,decodeOutboxMessages,typebotMessages} from "../scripts/transport-functions.mjs";

test("catalog presentation cannot be shortened by model output and transport preserves more than three blocks",()=>{
  const bot=typebot();
  const block=bot.groups.flatMap(g=>g.blocks).find(b=>b.id==="preservecatalog");
  const expression=block.options.expressionToEvaluate.replaceAll("{{business_context}}","contextInput").replaceAll("{{assistant_message}}","answer");
  // Typebot injectReturnKeywordIfNeeded does not add an outer return when the
  // expression contains an inner "return ". An IIFE silently lost the answer.
  const present=new Function("contextInput","answer",expression.includes("return ")?expression:"return "+expression);
  const listing=Array.from({length:12},(_,i)=>`Paquete ${i+1} — 4990 CLP`).join("\n");
  assert.equal(present(JSON.stringify({catalogListing:listing}),"Sólo tres opciones"),listing);
  assert.equal(present("{}", "Respuesta cordial"),"Respuesta cordial");
  assert.equal(present(JSON.stringify({purchaseSummary:"Resumen completo",catalogListing:listing}),"Otro texto"),"Resumen completo");
  assert.equal(present(JSON.stringify({catalogListing:null,purchaseSummary:null}),"Hola, bienvenido"),"Hola, bienvenido");
  assert.equal(typeof present("{}", ""),"string");
  const messages=Array.from({length:6},(_,i)=>`Opción ${i}`);
  assert.deepEqual(decodeOutboxMessages(encodeOutboxMessages(messages)),messages);
  assert.deepEqual(typebotMessages({messages:messages.map(text=>({type:"text",content:{richText:[{text}]}}))}),messages);
});

const proof={inboxId:"10000000-0000-4000-8000-000000000001",inboxLease:"10000000-0000-4000-8000-000000000002"};
test("Typebot function handles omitted arguments, awaits variable writes and preserves a pending decision",async()=>{
  const fn=typebot().groups.flatMap(g=>g.blocks).find(b=>b.type==="openai").options.functions[0];
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  async function invoke(args,pending="none",count=0){
    const vars={};
    const code=fn.code.replaceAll("{{decision_payload}}","pending").replaceAll("{{action_count}}","count");
    const result=await new AsyncFunction("setVariable","pending","count",...Object.keys(args),code)(async(name,value)=>{
      await Promise.resolve();vars[name]=value;
    },pending,count,...Object.values(args));
    return {result,vars};
  }
  const catalog=await invoke({action:"catalog"});
  assert.deepEqual(JSON.parse(decodeURIComponent(catalog.vars.decision_payload)),{action:"catalog",search:""});
  assert.equal(catalog.vars.action,"execute");
  const pickup=await invoke({action:"delivery",deliveryMethod:"pickup"});
  assert.deepEqual(JSON.parse(decodeURIComponent(pickup.vars.decision_payload)),{action:"delivery",selection:{method:"pickup"}});
  const shipping=await invoke({action:"delivery",deliveryMethod:"shipping",address:"Calle de prueba 123"});
  assert.equal(JSON.parse(decodeURIComponent(shipping.vars.decision_payload)).selection.address,"Calle de prueba 123");
  assert.deepEqual((await invoke({action:"confirm"},catalog.vars.decision_payload)).vars,{});
  assert.deepEqual((await invoke({action:"confirm"},"none",3)).vars,{});
});
test("Telegram review text and photo carry identical controls and verify Telegram returned them",()=>{
  const flow=notifications(),text=flow.nodes.find(n=>n.name==="Send Telegram text"),photo=flow.nodes.find(n=>n.name==="Send Telegram evidence");
  assert.deepEqual(text.parameters.inlineKeyboard,photo.parameters.inlineKeyboard);
  assert.equal(typeof text.parameters.inlineKeyboard,"object","fixedCollection uses native structure, not a whole-object expression");
  const mode=new Function("$json","return ("+text.parameters.replyMarkup.slice(3,-2)+")");
  const expected=[{callback_data:"approve:fixture"},{callback_data:"reject:fixture"},{callback_data:"info:fixture"}];
  const payload={replyMarkup:{inline_keyboard:[expected]}};
  assert.deepEqual(text.parameters.inlineKeyboard.rows[0].row.buttons.map(button=>{
    const expression=button.additionalFields.callback_data;
    return new Function("$json","return ("+expression.slice(3,-2)+")")({payload});
  }),expected.map(button=>button.callback_data));
  assert.equal(mode({payload}),"inlineKeyboard");assert.equal(mode({payload:{}}),"none");
  const verify=new Function("$json","$",flow.nodes.find(n=>n.name==="Verify Telegram controls").parameters.jsCode);
  const lookup=()=>({item:{json:{payload}}});
  assert.throws(()=>verify({ok:true,result:{message_id:1}},lookup),/TELEGRAM_REVIEW_BUTTONS_MISSING/);
  assert.equal(verify({ok:true,result:{message_id:1,reply_markup:payload.replyMarkup}},lookup)[0].json.buttons,3);
  assert.throws(()=>verify({ok:false},lookup),/TELEGRAM_SEND_UNCONFIRMED/);
  assert.equal(flow.connections["Send Telegram text"].main[0][0].node,"Verify Telegram controls");
});
test("one Typebot prompt offers natural greetings and support without a three-product cap",()=>{
  const models=typebot().groups.flatMap(g=>g.blocks).filter(b=>b.type==="openai");
  assert.equal(models.length,1);assert.equal(models[0].options.functions.length,1);
  assert.equal(models[0].options.functions[0].name,"operacion_comercial");
  assert.doesNotMatch(models[0].options.functions[0].parameters[0].values.join(","),/approve|dispatch/);
  assert.match(models[0].options.instructions,/hola buenas noches/);
  assert.match(models[0].options.instructions,/agente de ventas/);
  assert.match(models[0].options.instructions,/TODAS las opciones/);
  assert.match(models[0].options.instructions,/trato de usted/);
  assert.match(models[0].options.instructions,/NO condiciones universales/);
  assert.doesNotMatch(models[0].options.instructions,/máximo tres/);
});
test("bridge preserves every catalog row instead of silently truncating at twelve lines",()=>{
  const code=bridge().nodes.find(n=>n.name==="Prepare authorized result").parameters.jsCode;
  const rows=Array.from({length:30},(_,i)=>`Paquete ${i+1} — ${(i+1)*1000} CLP`);
  const input={text:rows.join("\n"),context:{options:rows}};
  const result=new Function("$json","$",code)(input,()=>({item:{json:{action:"consultar_catalogo"}}}))[0].json;
  assert.equal(result.operationResult,rows.join("\n"));
  assert.equal(JSON.parse(result.businessContext).options.length,30);
});
test("media request has no premature n8n expression delimiter and preserves the message key",()=>{
  const expression=salesWorker().nodes.find(node=>node.name==="Read Evolution media").parameters.jsonBody;
  assert.equal(expression.indexOf("}}"),expression.length-2,"nested object braces must not close the n8n expression");
  const $=()=>({item:{json:{contact:"56900000000",payload:{messageId:"fixture-media"}}}});
  const request=new Function("$","return ("+expression.slice(3,-2)+")")($);
  assert.deepEqual(request,{message:{key:{id:"fixture-media",remoteJid:"56900000000@s.whatsapp.net",fromMe:false}},convertToMp4:false});
});

test("all evidence and notification expressions keep nested braces separate from n8n delimiters",()=>{
  function inspect(value,path){
    if(typeof value==="string"&&value.startsWith("={{")){
      assert.equal(value.indexOf("}}"),value.length-2,path);
      assert.doesNotThrow(()=>new Function("return ("+value.slice(3,-2)+")"),path);
    }else if(value&&typeof value==="object"){
      for(const [key,child] of Object.entries(value))inspect(child,path+"."+key);
    }
  }
  for(const workflow of [salesWorker(),notifications()])for(const node of workflow.nodes)inspect(node.parameters,node.name);
  const keyboard=notifications().nodes.find(node=>node.name==="Send Telegram evidence").parameters.inlineKeyboard;
  const payload={replyMarkup:{inline_keyboard:[[{text:"Verificar y aprobar",callback_data:"approve:fixture"}]]}};
  const expression=keyboard.rows[0].row.buttons[0].additionalFields.callback_data;
  assert.equal(new Function("$json","return ("+expression.slice(3,-2)+")")({payload}),"approve:fixture");
});

test("Typebot reads bridge fields through options mappings and the real HTTP data envelope",()=>{
  const bot=typebot();
  const blocks=bot.groups.flatMap(group=>group.blocks).filter(block=>block.options?.webhook);
  for(const block of blocks){
    assert.ok(block.options.responseVariableMapping?.length,"runtime reads options.responseVariableMapping");
    assert.equal(block.responseVariableMapping,undefined,"root-level mappings are ignored by Typebot");
  }
  const prepared=blocks.find(block=>block.id==="prepareturn");
  // n8n returns {data: ...}; Typebot supplies the whole parsed body as the expression's data argument.
  const fields={businessContext:'{"phase":"browse"}',backendReady:"yes",replyAllowed:"yes",
    userMessage:"hola",operationResult:"¿Qué servicio necesitas?",remoteJid:"56912345678",
    pushName:"Cliente",turnId:"tb-fixture",actionCompleted:"yes"};
  const response={statusCode:200,data:{data:fields}};
  const values=Object.fromEntries(prepared.options.responseVariableMapping.map(mapping=>{
    const name=bot.variables.find(variable=>variable.id===mapping.variableId).name;
    return [name,new Function("statusCode","data","return ("+mapping.bodyPath+")")(response.statusCode,response.data)];
  }));
  assert.equal(values.backend_ready,"yes");
  assert.equal(values.reply_allowed,"yes");
  assert.equal(values.business_context,fields.businessContext);
  assert.equal(values.operation_result,fields.operationResult);
  assert.equal(values.user_message,"hola");
});

test("Typebot evaluates input variables as values, preserving quotes, newlines and message identity",()=>{
  const bot=typebot(),vars={};
  const payload={...proof,contact:"56912345678",name:'Cliente "prueba"',messageId:"wamid-1",text:'¿Son "reales"?\n{{no_ejecutar}} 🛒'};
  vars.incoming_payload=typebotEnvelope({sessionToken:"cs_"+"a".repeat(43)},payload);
  const blocks=bot.groups.find(group=>group.id==="prepare").blocks;
  for(const block of blocks.filter(block=>block.type==="Set variable")){
    const name=bot.variables.find(v=>v.id===block.options.variableId).name;
    const expression=block.options.expressionToEvaluate;
    if(expression.includes("{{")||expression==='""'){
      assert.doesNotMatch(expression,/"\{\{[^}]+\}\}"/,"quoted Typebot references become IDs, not variable values");
      const code=expression.replace(/\{\{([^}]+)\}\}/g,(_,name)=>"vars["+JSON.stringify(name)+"]");
      vars[name]=new Function("vars","return ("+code+")")(vars);
    }else vars[name]=expression;
  }
  const request=JSON.parse(decodeURIComponent(vars.request_payload));
  assert.equal(request.userMessage,payload.text);
  assert.equal(request.remoteJid,payload.contact);
  assert.equal(request.messageId,payload.messageId);
  assert.equal(request.inboxId,proof.inboxId);
  assert.equal(request.inboxLease,proof.inboxLease);
  assert.equal(vars.incoming_payload,"");
  assert.equal(vars.backend_ready,"no");
});

test("Typebot cannot call the bridge without a leased inbox proof",()=>{
  const code=bridge().nodes.find(node=>node.name==="Validate Typebot turn").parameters.jsCode;
  const validate=body=>new Function("$json","$execution",code)({body},{id:"test"});
  const payload={agentVersion:2,mode:"prepare",remoteJid:"56912345678",messageId:"1",userMessage:"hola"};
  assert.throws(()=>validate(payload),/TYPEBOT_INBOX_PROOF_MISSING/);
  assert.throws(()=>validate({...payload,...proof,mode:"act"}),/TYPEBOT_ACTION_LIMIT/);
  assert.throws(()=>validate({...payload,...proof,mode:"act",actionStep:4}),/TYPEBOT_ACTION_LIMIT/);
  assert.equal(validate({...payload,...proof,mode:"act",actionStep:1,turnId:"tb-test"})[0].json.mode,"act");
  const result=validate({...payload,...proof})[0].json;
  assert.equal(result.lease,proof.inboxLease);
  assert.equal(result.inboxId,proof.inboxId);
  const open=bridge().nodes.find(node=>node.name==="Open current sales session");
  assert.equal(open.parameters.jsonBody,"={{ {inboxId:$json.inboxId,lease:$json.lease} }}");
});

test("bridge sends the canonical inbox message, not an injected Typebot operation",()=>{
  const code=bridge().nodes.find(node=>node.name==="Resolve agent decision").parameters.jsCode;
  const $=name=>({item:{json:name==="Open current sales session"
    ? {incomingMessage:{text:"¿Cómo funciona?",messageId:"real-id",contact:"56912345678"}}
    : {agentVersion:2,mode:"prepare",userMessage:"si",messageId:"injected",contact:"56999999999",actionCompleted:"no"}}});
  const result=new Function("$",code)($)[0].json;
  assert.equal(result.backendText,"¿Cómo funciona?");
  assert.equal(result.contact,"56912345678");
  assert.equal(result.messageId,"real-id:agent:0");
  assert.equal(result.action,"prepare");
  assert.equal(result.decision,null,"prepare must not execute an injected decision");
});

test("one outbox event produces one ordered WhatsApp send, not several repeated bubbles",()=>{
  const code=notifications().nodes.find(node=>node.name==="Expand WhatsApp bubbles").parameters.jsCode;
  const result=new Function("$json",code)({id:"notification",payload:{text:encodeOutboxMessages(["Opción A","Opción B","¿Cuál prefieres?"])}});
  assert.equal(result.length,1);
  assert.equal(result[0].json.whatsappText,"Opción A\n\nOpción B\n\n¿Cuál prefieres?");
});

test("failed bridge and human pause cannot reuse a previous OpenAI answer",()=>{
  const t=typebot(),blocks=t.groups.flatMap(group=>group.blocks);
  assert.ok(blocks.some(block=>block.id==="resetanswer"&&block.options.expressionToEvaluate==='""'));
  assert.equal(t.edges.find(edge=>edge.id==="preparedge").to.groupId,"gateway");
  assert.equal(t.edges.find(edge=>edge.id==="failureedge").to.groupId,"failure");
  assert.equal(t.edges.find(edge=>edge.id==="silentedge").to.groupId,"silent");
  const model=blocks.find(block=>block.type==="openai");
  assert.match(model.options.message,/business_context/);
  assert.equal(model.options.functions.length,1);
  assert.ok(blocks.some(b=>b.id==="resetactcontinue"&&b.options.expressionToEvaluate==="no"));
  assert.ok(blocks.some(b=>b.id==="resetactcontext"&&b.options.expressionToEvaluate==='"{}"'));
});
