import {workflow,node,link,http,configNode,backend,credential} from "./workflow-helpers.mjs";
import {normalizeEvolution} from "./transport-functions.mjs";
export function ingress(){
  const w=workflow("BW 01 — Evolution 2.3.4 → bandeja durable");
  node(w,"Evolution webhook","webhook",{httpMethod:"POST",path:"bw-evolution-sales",authentication:"headerAuth",responseMode:"lastNode",options:{}},credential("httpHeaderAuth","BW Evolution Webhook"));
  configNode(w);
  node(w,"Normalize incoming","code",{jsCode:`${normalizeEvolution.toString()}\nconst message=normalizeEvolution($json.body,$json.config.instance);return message?[{json:message}]:[];`});
  http(w,"Save inbox",backend("/bot/v1/sales/inbox"),"={{ $json }}","BW Backend");
  link(w,"Evolution webhook","Config");link(w,"Config","Normalize incoming");link(w,"Normalize incoming","Save inbox");
  return w;
}
