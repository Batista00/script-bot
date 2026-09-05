import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { ingress } from "../scripts/build-ingress.mjs";
import { bridge } from "../scripts/build-bridge.mjs";
import { salesWorker } from "../scripts/build-sales-worker.mjs";
import { notifications } from "../scripts/build-notifications.mjs";
import { telegramAdmin } from "../scripts/build-telegram-admin.mjs";
import { typebot } from "../scripts/build-typebot.mjs";
import { typebotEnvelope,typebotRequest,typebotSessionMissing,validateTypebotResponse } from "../scripts/typebot-session.mjs";

for(const [path,build] of [["01-evolution-inbox",ingress],["02-typebot-sales-bridge",bridge],["03-sales-worker",salesWorker],["04-notifications-worker",notifications],["05-telegram-admin",telegramAdmin]]){
  test(`${path}: deterministic inactive export, valid nodes and credential references`,async()=>{
    const w=JSON.parse(await readFile(new URL(`../n8n/${path}.json`,import.meta.url),"utf8"));assert.deepEqual(w,build());
    assert.equal(w.active,false);assert.deepEqual(w.pinData,{});
    const names=new Set(w.nodes.map(n=>n.name));assert.equal(names.size,w.nodes.length);
    for(const [source,connections] of Object.entries(w.connections)){
      assert.ok(names.has(source));for(const output of connections.main)for(const edge of output)assert.ok(names.has(edge.node),edge.node);
    }
    for(const n of w.nodes){
      assert.ok(n.typeVersion);for(const credential of Object.values(n.credentials ?? {}))assert.deepEqual(Object.keys(credential),["name"]);
      if(n.type.endsWith(".code"))assert.doesNotThrow(()=>new Function(n.parameters.jsCode));
      const strings=JSON.stringify(n.parameters);
      for(const reference of strings.matchAll(/\$\('([^']+)'\)/g))assert.ok(names.has(reference[1]),reference[1]);
    }
    assert.equal(w.settings.saveDataSuccessExecution,"none");assert.equal(w.settings.saveDataErrorExecution,"none");
  });
}
test("Typebot 6.1 presentation has valid references and no business/provider credential",async()=>{
  const t=JSON.parse(await readFile(new URL("../typebot/sales-assistant-6.1.json",import.meta.url),"utf8"));assert.deepEqual(t,typebot());assert.equal(t.version,"6.1");
  const groups=new Set(t.groups.map(g=>g.id));const blocks=new Set(t.groups.flatMap(g=>g.blocks).map(b=>b.id));
  for(const edge of t.edges){assert.ok(groups.has(edge.to.groupId));if(edge.to.blockId)assert.ok(blocks.has(edge.to.blockId));if(edge.from.blockId)assert.ok(blocks.has(edge.from.blockId));}
  const raw=JSON.stringify(t);assert.ok(!raw.includes("backend_token"));assert.ok(!raw.includes("providerKey"));assert.ok(!raw.includes("businessId"));
  assert.ok(!raw.includes("sk-"));assert.ok(!raw.includes("apiKey"));
  assert.ok(t.variables.every(v=>!("value" in v)));
  const webhookDefinition=t.groups.flatMap(g=>g.blocks).find(b=>b.type==="Webhook").options.webhook;
  const target=webhookDefinition.url;
  assert.equal(target,"https://n8n.pablete.xyz/webhook/bw-sales-bridge");
  assert.ok(!target.includes("{{"),"customer-prefilled variables must never choose a server-side request destination");
  assert.match(webhookDefinition.body,/"remoteJid":"{{remoteJid}}"/);
  assert.match(webhookDefinition.body,/"userMessage":"{{user_message}}"/);
  assert.ok(t.groups.flatMap(g=>g.blocks).some(b=>b.id==="buildpreparepayload"));
  assert.equal(t.variables.some(variable=>variable.name==="session_token"),false,"backend cs_ tokens must not persist as a Typebot session variable");
  assert.equal(raw.includes("sessionToken"),false,"backend session tokens must never reach Typebot");
  const webhooks=t.groups.flatMap(g=>g.blocks).filter(b=>b.type==="Webhook");
  assert.ok(webhooks.every(webhook=>webhook.options.webhook.headers.every(header=>header.key.toLowerCase()!=="authorization")));
  const inputBlock=t.groups.flatMap(g=>g.blocks).find(b=>b.id==="nextinput");
  assert.equal(inputBlock.type,"text input");
  assert.ok(t.edges.some(edge=>edge.to.blockId==="nextinput"),"the external chat must wait for continueChat input");
  assert.equal(inputBlock.options.variableId,t.variables.find(variable=>variable.name==="user_message").id);
  assert.ok(t.variables.some(variable=>variable.name==="remoteJid"),"Evolution must prefill the WhatsApp contact");
});

test("Evolution ingress acknowledges ignored events without persisting them",()=>{
  const w=ingress();
  assert.deepEqual(w.connections["Has message"].main[0],[{node:"Save inbox",type:"main",index:0}]);
  assert.deepEqual(w.connections["Has message"].main[1],[{node:"Ignore safely",type:"main",index:0}]);
  const normalize=w.nodes.find(n=>n.name==="Normalize incoming");
  assert.match(normalize.parameters.jsCode,/message \?\? \{ignored:true\}/);
});

test("sales worker chooses startChat once, continueChat afterwards and persists replacement session IDs",()=>{
  const w=salesWorker();
  const prepare=w.nodes.find(n=>n.name==="Prepare Typebot request");
  const start=w.nodes.find(n=>n.name==="Start Typebot");
  const continued=w.nodes.find(n=>n.name==="Continue Typebot");
  const save=w.nodes.find(n=>n.name==="Save Typebot session");
  assert.ok(prepare);assert.ok(start);assert.ok(continued);assert.ok(save);
  assert.match(prepare.parameters.jsCode,/SALES_SESSION_TOKEN_MISSING/);
  assert.match(prepare.parameters.jsCode,/\$\('Open session'\)\.item/);
  assert.doesNotMatch(prepare.parameters.jsCode,/\$\('Open session'\)\.first\(\)/);
  assert.match(start.parameters.url,/startChat/);assert.match(prepare.parameters.jsCode,/continueChat/);
  assert.equal(continued.parameters.url,"={{ $json.request.url }}");
  assert.equal(save.parameters.method,"PUT");assert.match(save.parameters.url,/typebot-session/);
  assert.deepEqual(w.connections["Has Typebot session"].main[0],[{node:"Continue Typebot",type:"main",index:0}]);
  assert.deepEqual(w.connections["Has Typebot session"].main[1],[{node:"Start Typebot",type:"main",index:0}]);
  assert.deepEqual(w.connections["Session missing"].main[0],[{node:"Start Typebot",type:"main",index:0}]);
});

test("immediate and recovery processing open the current sales session before Typebot can call conversation",()=>{
  const worker=salesWorker();
  const next=(name,output=0)=>(worker.connections[name]?.main?.[output]??[]).map(edge=>edge.node);
  const reaches=(from,target,seen=new Set())=>{
    if(from===target)return true;
    if(seen.has(from))return false;
    const visited=new Set(seen);visited.add(from);
    return (worker.connections[from]?.main??[]).flat().some(edge=>reaches(edge.node,target,visited));
  };
  assert.deepEqual(next("Process now"),["Config"]);
  assert.deepEqual(next("Every minute"),["Config"]);
  assert.deepEqual(next("Each message",1),["Open session"]);
  assert.ok(reaches("Config","Open session"));
  assert.ok(reaches("Open session","Prepare Typebot request"));
  assert.ok(reaches("Process now","Prepare Typebot request"));
  const prepare=worker.nodes.find(node=>node.name==="Prepare Typebot request");
  assert.match(prepare.parameters.jsCode,/typebotEnvelope\(opened,payload\)/);
  assert.match(prepare.parameters.jsCode,/SALES_SESSION_TOKEN_MISSING/);

  const salesBridge=bridge();
  const bridgeNext=(name,output=0)=>(salesBridge.connections[name]?.main?.[output]??[]).map(edge=>edge.node);
  const validator=salesBridge.nodes.find(node=>node.name==="Validate Typebot turn");
  const open=salesBridge.nodes.find(node=>node.name==="Open current sales session");
  const conversation=salesBridge.nodes.find(node=>node.name==="Execute authorized operation");
  assert.match(validator.parameters.jsCode,/TYPEBOT_CONTACT_INVALID/);
  assert.deepEqual(bridgeNext("Validate Typebot turn"),["Open current sales session"]);
  assert.deepEqual(bridgeNext("Open current sales session"),["Is agent action"]);
  assert.match(open.parameters.url,/sales\/sessions/);
  assert.equal(conversation.parameters.headerParameters.parameters[0].value,"={{ 'Bearer ' + $('Open current sales session').item.json.sessionToken }}");
  assert.doesNotMatch(JSON.stringify(typebot()),/cs_\[|sessionToken|Authorization/);
});

test("Typebot session request contract supports first turn, continuation and expiry recovery",()=>{
  const opened={sessionToken:`cs_${"a".repeat(43)}`,typebotSessionId:null};
  const payload={messageId:"wamid-1",text:"Hola"};
  const envelope=typebotEnvelope(opened,payload);
  const first=typebotRequest("https://bot.example","public",null,envelope);
  assert.equal(first.mode,"start");assert.match(first.url,/\/typebots\/public\/startChat$/);
  assert.equal(first.body.prefilledVariables.incoming_payload,envelope);
  const next=typebotRequest("https://bot.example","public","session-1",envelope);
  assert.equal(next.mode,"continue");assert.match(next.url,/\/sessions\/session-1\/continueChat$/);
  assert.deepEqual(next.body,{message:envelope});
  assert.equal(typebotSessionMissing({statusCode:404,body:{message:"Not found"}}),true);
  assert.equal(typebotSessionMissing({statusCode:400,body:{message:"Session expired"}}),true);
  assert.equal(typebotSessionMissing({statusCode:500,body:{message:"Failure"}}),false);
  assert.deepEqual(validateTypebotResponse({statusCode:200,body:{sessionId:"session-1",messages:[]}},"session-1"),
    {response:{sessionId:"session-1",messages:[]},typebotSessionId:"session-1",sessionChanged:false});
  assert.equal(validateTypebotResponse({statusCode:200,body:{sessionId:"session-2",messages:[]}},"session-1").sessionChanged,true);
  const inspect=salesWorker().nodes.find(node=>node.name==="Inspect continued session").parameters.jsCode;
  const continuation=salesWorker().nodes.find(node=>node.name==="Continue Typebot");
  const restart=salesWorker().nodes.find(node=>node.name==="Start Typebot");
  assert.match(inspect,/typeof body\?\.sessionId/);
  assert.match(inspect,/Array\.isArray\(body\.messages\).*recover:true/);
  assert.match(inspect,/status<200\|\|status>=300\)return \[\{json:\{recover:true,incomingPayload\}/);
  assert.equal(continuation.parameters.options.response.response.responseFormat,"text");
  assert.equal(continuation.onError,"continueRegularOutput");
  assert.equal(restart.parameters.jsonBody,"={{ ({prefilledVariables:{incoming_payload:$json.incomingPayload}}) }}");
  assert.match(inspect,/pairedItem:\{item:0\}/);
  assert.match(inspect,/JSON\.parse\(rawBody\)/);
  assert.deepEqual(validateTypebotResponse({statusCode:200,body:JSON.stringify({sessionId:"session-3",messages:[]})},"session-2"),
    {response:{sessionId:"session-3",messages:[]},typebotSessionId:"session-3",sessionChanged:true});
});

test("Typebot association is obtained from the business-scoped backend session, never from a global phone key",()=>{
  const w=salesWorker();const worker=JSON.stringify(w);
  assert.match(worker,/opened\.typebotSessionId/);
  assert.match(worker,/Open session/);
  assert.doesNotMatch(worker,/staticData|workflowStaticData/);
  assert.doesNotMatch(w.nodes.find(n=>n.name==="Prepare Typebot request").parameters.jsCode,/contact.*typebotSessionId/);
  const sameContact={messageId:"1",text:"hola"};
  const a=typebotEnvelope({sessionToken:`cs_${"a".repeat(43)}`},sameContact);
  const b=typebotEnvelope({sessionToken:`cs_${"b".repeat(43)}`},sameContact);
  assert.notEqual(a,b,"different business-scoped session tokens must not share the Typebot turn envelope");
});

test("n8n contains no conversational OpenAI call; the sole master prompt is the bounded Typebot Ask Model",()=>{
  const n8n=[bridge(),salesWorker(),notifications(),ingress()];
  const conversational=n8n.flatMap(w=>w.nodes).filter(n=>n.name==="OpenAI advisory");
  assert.equal(conversational.length,0);
  assert.ok(!JSON.stringify(bridge()).includes("api.openai.com"));
  const t=typebot();const ask=t.groups.flatMap(g=>g.blocks).filter(b=>b.type==="openai"&&b.options.action==="Ask Model");
  assert.equal(ask.length,1);assert.ok(!("credentialsId" in ask[0].options));
  assert.match(ask[0].options.instructions,/una y cuatro frases/);
  assert.match(ask[0].options.instructions,/Nunca apruebes pagos/);
  assert.match(ask[0].options.instructions,/únicas fuentes permitidas/);
  assert.ok(ask[0].options.responseIdVariableId);
});

test("durable inbox and outbox have immediate triggers while minute schedules remain recovery",()=>{
  const inFlow=ingress();const worker=salesWorker();const delivery=notifications();
  assert.deepEqual(inFlow.connections["Save inbox"].main[0],[{node:"Trigger immediate processing",type:"main",index:0}]);
  assert.ok(worker.nodes.some(n=>n.name==="Process now"&&n.parameters.responseMode==="onReceived"));
  assert.deepEqual(worker.connections["Finish inbox and queue reply"].main[0],[{node:"Trigger immediate delivery",type:"main",index:0}]);
  assert.ok(delivery.nodes.some(n=>n.name==="Deliver now"&&n.parameters.responseMode==="onReceived"));
  assert.ok(worker.nodes.some(n=>n.type.endsWith("scheduleTrigger")),"inbox recovery schedule must remain");
  assert.ok(delivery.nodes.some(n=>n.type.endsWith("scheduleTrigger")),"outbox recovery schedule must remain");
  assert.match(inFlow.nodes.find(n=>n.name==="Normalize incoming").parameters.jsCode,/messageId/);
});

test("WhatsApp delivery expands ordered bubbles with human-scale delay and acknowledges once",()=>{
  const w=notifications();const expand=w.nodes.find(n=>n.name==="Expand WhatsApp bubbles");
  const send=w.nodes.find(n=>n.name==="Send WhatsApp");const verify=w.nodes.find(n=>n.name==="Verify WhatsApp result");
  assert.match(expand.parameters.jsCode,/600\+index\*150/);assert.match(send.parameters.jsonBody,/whatsappDelay/);
  assert.match(verify.parameters.jsCode,/return \[\{json:\{ok:true,count:sent.length\}\}\]/);
  assert.deepEqual(w.connections["Verify WhatsApp result"].main[0],[{node:"Acknowledge delivered",type:"main",index:0}]);
});
