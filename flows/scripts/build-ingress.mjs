import {workflow,node,link,http,configNode,backend,credential,branch} from "./workflow-helpers.mjs";
import {normalizeEvolution} from "./transport-functions.mjs";
export function ingress(){
  const w=workflow("BW 01 — Evolution 2.3.4 → bandeja durable");
  node(w,"Evolution webhook","webhook",{httpMethod:"POST",path:"bw-evolution-sales",authentication:"headerAuth",responseMode:"lastNode",options:{}},credential("httpHeaderAuth","BW Evolution Webhook"));
  configNode(w);
  node(w,"Normalize incoming","code",{jsCode:`${normalizeEvolution.toString()}\nconst message=normalizeEvolution($json.body,$json.config.instance);return [{json:message ?? {ignored:true}}];`});
  branch(w,"Has message","={{ Boolean($json.contact) }}");
  http(w,"Save inbox",backend("/bot/v1/sales/inbox"),"={{ $json }}","BW Backend");
  node(w,"Ignore safely","code",{jsCode:"return [{json:{ok:true,ignored:true}}];"});
  link(w,"Evolution webhook","Config");link(w,"Config","Normalize incoming");link(w,"Normalize incoming","Has message");
  link(w,"Has message","Save inbox",0);link(w,"Has message","Ignore safely",1);
  return w;
}
