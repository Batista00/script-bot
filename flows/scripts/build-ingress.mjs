import {workflow,node,link,http,configNode,backend,credential,branch,cfg} from "./workflow-helpers.mjs";
import {normalizeEvolution} from "./transport-functions.mjs";
export function ingress(){
  const w=workflow("BW 01 — Evolution 2.3.4 → bandeja durable");
  node(w,"Evolution webhook","webhook",{httpMethod:"POST",path:"bw-evolution-sales",authentication:"headerAuth",responseMode:"lastNode",options:{}},{...credential("httpHeaderAuth","BW Evolution Webhook"),webhookId:"0bdc2cb0-4f7b-419e-865d-bb350a62a93a"});
  configNode(w);
  node(w,"Normalize incoming","code",{jsCode:`${normalizeEvolution.toString()}\nconst message=normalizeEvolution($json.body,$json.config.instance);return [{json:message ?? {ignored:true}}];`});
  branch(w,"Has message","={{ Boolean($json.contact) }}");
  http(w,"Save inbox",backend("/bot/v1/sales/inbox"),"={{ $json }}","BW Backend");
  http(w,"Trigger immediate processing",`={{ ${cfg("n8nBaseUrl")} + '/webhook/bw-sales-process' }}`,"={{ {source:'evolution'} }}","BW Evolution Webhook");
  w.nodes.find(n=>n.name==="Trigger immediate processing").onError="continueRegularOutput";
  node(w,"Accepted","code",{jsCode:"return [{json:{ok:true,accepted:true}}];"});
  node(w,"Ignore safely","code",{jsCode:"return [{json:{ok:true,ignored:true}}];"});
  link(w,"Evolution webhook","Config");link(w,"Config","Normalize incoming");link(w,"Normalize incoming","Has message");
  link(w,"Has message","Save inbox",0);link(w,"Save inbox","Trigger immediate processing");link(w,"Trigger immediate processing","Accepted");
  link(w,"Has message","Ignore safely",1);
  return w;
}
