import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { ingress } from "../scripts/build-ingress.mjs";
import { bridge } from "../scripts/build-bridge.mjs";
import { salesWorker } from "../scripts/build-sales-worker.mjs";
import { notifications } from "../scripts/build-notifications.mjs";
import { typebot } from "../scripts/build-typebot.mjs";

for(const [path,build] of [["01-evolution-inbox",ingress],["02-typebot-sales-bridge",bridge],["03-sales-worker",salesWorker],["04-notifications-worker",notifications]]){
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
  const groups=new Set(t.groups.map(g=>g.id));for(const edge of t.edges)assert.ok(groups.has(edge.to.groupId));
  const raw=JSON.stringify(t);assert.ok(!raw.includes("backend_token"));assert.ok(!raw.includes("providerKey"));assert.ok(!raw.includes("businessId"));
  assert.ok(!raw.includes("sk-"));assert.ok(!raw.includes("apiKey"));
  assert.ok(raw.includes("JSON.stringify"));assert.ok(t.variables.every(v=>!("value" in v)));
  const target=t.groups.flatMap(g=>g.blocks).find(b=>b.type==="Webhook").options.webhook.url;
  assert.equal(target,"https://n8n.pablete.xyz/webhook/bw-sales-bridge");
  assert.ok(!target.includes("{{"),"customer-prefilled variables must never choose a server-side request destination");
  const builder=t.groups.flatMap(g=>g.blocks).find(b=>b.id==="buildbody");
  assert.equal(builder.options.isCode,true);
  const input='Texto con "comillas", salto\ny \\ barra';
  const code=builder.options.expressionToEvaluate.replaceAll("{{message_id}}",JSON.stringify("fixture")).replaceAll("{{customer_message}}",JSON.stringify(input));
  assert.deepEqual(JSON.parse(new Function(`return (${code})`)()),{messageId:"fixture",text:input});
});
