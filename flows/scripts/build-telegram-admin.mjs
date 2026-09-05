import {workflow,node,link,http,configNode,backend,branch} from "./workflow-helpers.mjs";

export function telegramAdmin(){
  const w=workflow("BW 05 — Telegram Admin → revisión humana");
  node(w,"Telegram webhook","webhook",{httpMethod:"POST",path:"bw-telegram-admin",responseMode:"responseNode",options:{}},{webhookId:"7a0eb3f8-49fb-4314-ae7c-6114b3ec4a4d"});
  configNode(w);
  node(w,"Validate Telegram update","code",{jsCode:`const update=$json.body&&typeof $json.body==='object'?$json.body:{};
const headers=$json.headers&&typeof $json.headers==='object'?$json.headers:{};
const secret=String(headers['x-telegram-bot-api-secret-token']||'');
if(!/^[A-Za-z0-9_-]{32,256}$/.test(secret))throw new Error('TELEGRAM_SECRET_MISSING');
const callback=update.callback_query;
const message=update.message;
const callbackValid=Boolean(callback&&typeof callback.id==='string'&&Number.isInteger(callback.from?.id)&&
  /^(?:approve|reject|info):[A-Za-z0-9_-]{32}$/.test(String(callback.data||'')));
const messageValid=Boolean(message&&Number.isInteger(message.chat?.id)&&
  /^\\/abono(?:@[A-Za-z0-9_]+)? [A-Za-z0-9_-]{32} .{1,128}$/.test(String(message.text||'')));
return [{json:{valid:callbackValid||messageValid,secret,update}}];`});
  branch(w,"Operational update","={{ $json.valid === true }}");
  http(w,"Forward authorized decision",`={{ ${"$('Config').first().json.config.backendBaseUrl"} + '/webhooks/telegram/' + encodeURIComponent($('Config').first().json.config.telegramIntegrationId) }}`,
    "={{ $json.update }}",null,{sendHeaders:true,headerParameters:{parameters:[{name:"x-telegram-bot-api-secret-token",value:"={{ $json.secret }}"}]},
      options:{timeout:30000,redirect:{redirect:{followRedirects:false}},response:{response:{neverError:true,fullResponse:true,responseFormat:"json"}}}});
  node(w,"Verify backend decision","code",{jsCode:"const status=Number($json.statusCode||200);if(status<200||status>=300)throw new Error('TELEGRAM_DECISION_REJECTED');return [{json:{ok:true}}];"});
  node(w,"Ignore non operational update","code",{jsCode:"return [{json:{ok:true,ignored:true}}];"});
  node(w,"Reply Telegram","respondToWebhook",{respondWith:"json",responseBody:"={{ $json }}",options:{}});
  link(w,"Telegram webhook","Config");link(w,"Config","Validate Telegram update");link(w,"Validate Telegram update","Operational update");
  link(w,"Operational update","Forward authorized decision",0);link(w,"Operational update","Ignore non operational update",1);
  link(w,"Forward authorized decision","Verify backend decision");link(w,"Verify backend decision","Reply Telegram");link(w,"Ignore non operational update","Reply Telegram");
  return w;
}
