import {workflow,node,link,http,configNode,backend,runner,branch,cfg,scopedHeaders,credential,source} from "./workflow-helpers.mjs";
import {typebotText,typebotMessages,encodeOutboxMessages} from "./transport-functions.mjs";
import {typebotEnvelope,typebotRequest,typebotSessionMissing,validateTypebotResponse} from "./typebot-session.mjs";
import {addEvidenceAnalysis} from "./build-evidence-analysis.mjs";
import {evidenceResponse} from "./evidence-response.mjs";
export function salesWorker(){
  const w=workflow("BW 03 — Procesar ventas y comprobantes");
  node(w,"Every minute","scheduleTrigger",{rule:{interval:[{field:"minutes",minutesInterval:1}]}});
  node(w,"Process now","webhook",{httpMethod:"POST",path:"bw-sales-process",authentication:"headerAuth",responseMode:"onReceived",options:{}},{...credential("httpHeaderAuth","BW Evolution Webhook"),webhookId:"a6063f4a-f60a-46a4-a2de-4c49e5c08b0b"});
  configNode(w);
  http(w,"Claim inbox",runner("/inbox/claim"),"{}","BW Automation Runner");
  node(w,"Inbox items","code",{jsCode:"return ($json.items||[]).map(item=>({json:item}));"});
  node(w,"Each message","splitInBatches",{batchSize:1,options:{}});
  http(w,"Open session",backend("/bot/v1/sales/sessions"),"={{ {contact:$json.contact,name:$json.payload.name} }}","BW Backend");
  branch(w,"Is image","={{ $('Each message').item.json.payload.image }}");
  http(w,"Read Evolution media",`={{ ${cfg("evolutionBaseUrl")} + '/chat/getBase64FromMediaMessage/' + encodeURIComponent(${cfg("instance")}) }}`,
    "={{ {message:{key:{id:$('Each message').item.json.payload.messageId,remoteJid:$('Each message').item.json.contact+'@s.whatsapp.net',fromMe:false} },convertToMp4:false} }}","Evolution API");
  node(w,"Check media limits","code",{jsCode:"const valid=typeof $json.base64==='string'&&$json.base64.length<=2800000&&['image/jpeg','image/png'].includes($json.mimetype);return [{json:valid?{...$json,valid}:{valid,error:{code:'INVALID_PAYMENT_EVIDENCE'}}}];"});
  branch(w,"Media usable","={{ $json.valid }}");
  http(w,"Submit private evidence",backend("/conversation/v1/evidence"),"={{ {base64:$json.base64,mimeType:$json.mimetype} }}",null,
    {...scopedHeaders,options:{timeout:60000,redirect:{redirect:{followRedirects:false}},response:{response:{neverError:true}}}});
  node(w,"Validate evidence result","code",{jsCode:`${source(evidenceResponse)}\nreturn [{json:evidenceResponse($json)}];`});
  node(w,"Prepare Typebot request","code",{jsCode:`${source(typebotEnvelope)}\n${source(typebotRequest)}
const opened=$('Open session').item.json;
const entry=$('Each message').item.json;
const payload={...entry.payload,inboxId:entry.id,inboxLease:entry.lease};
const envelope=typebotEnvelope(opened,payload);
const request=typebotRequest($('Config').first().json.config.typebotBaseUrl,$('Config').first().json.config.typebotPublicId,opened.typebotSessionId,envelope);
return [{json:{request,incomingPayload:envelope,previousSessionId:opened.typebotSessionId}}];`});
  branch(w,"Has Typebot session","={{ $json.request.mode === 'continue' }}");
  const responseOptions={options:{timeout:60000,redirect:{redirect:{followRedirects:false}},response:{response:{neverError:true,fullResponse:true,responseFormat:"text",outputPropertyName:"body"}}}};
  http(w,"Continue Typebot","={{ $json.request.url }}","={{ $json.request.body }}",null,responseOptions);
  w.nodes.find(n=>n.name==="Continue Typebot").onError="continueRegularOutput";
  node(w,"Inspect continued session","code",{jsCode:`${source(typebotSessionMissing)}
const incomingPayload=$('Prepare Typebot request').item.json.incomingPayload;
const status=Number($json.statusCode||0);
if(typebotSessionMissing($json))return [{json:{recover:true,incomingPayload},pairedItem:{item:0}}];
if(status<200||status>=300)return [{json:{recover:true,incomingPayload},pairedItem:{item:0}}];
const rawBody=$json.body??$json;
let body=rawBody;
if(typeof rawBody==="string"){try{body=JSON.parse(rawBody);}catch{return [{json:{recover:true,incomingPayload},pairedItem:{item:0}}];}}
if((body?.sessionId!=null&&(typeof body.sessionId!=="string"||!body.sessionId))||!Array.isArray(body?.messages))return [{json:{recover:true,incomingPayload},pairedItem:{item:0}}];
return [{json:{recover:false,continued:true,response:{...$json,body},incomingPayload},pairedItem:{item:0}}];`});
  branch(w,"Session missing","={{ $json.recover === true }}");
  http(w,"Start Typebot",`={{ ${cfg("typebotBaseUrl")} + '/api/v1/typebots/' + encodeURIComponent(${cfg("typebotPublicId")}) + '/startChat' }}`,
    "={{ ({message:$json.incomingPayload}) }}",null,responseOptions);
  node(w,"Validate Typebot response","code",{jsCode:`${source(validateTypebotResponse)}
const previous=$('Prepare Typebot request').item.json.previousSessionId;
return [{json:validateTypebotResponse($json.response||$json,previous,$json.continued===true)}];`});
  branch(w,"Session changed","={{ $json.sessionChanged === true }}");
  http(w,"Save Typebot session",backend("/conversation/v1/typebot-session"),"={{ {typebotSessionId:$json.typebotSessionId} }}",null,{...scopedHeaders,method:"PUT"});
  node(w,"Read Typebot reply","code",{jsCode:`${source(typebotText)}\n${source(typebotMessages)}\n${source(encodeOutboxMessages)}
const result=$('Validate Typebot response').item.json;
const messages=typebotMessages(result.response);
const silent=result.response.input?.id==='silentinput';
const safeMessages=messages.length?messages:silent?[]:['No pude completar esa consulta en este momento. Puedo intentarlo nuevamente o derivarte con una persona.'];
return [{json:{messages:safeMessages,text:safeMessages.length?encodeOutboxMessages(safeMessages):''}}];`});
  http(w,"Finish inbox and queue reply",runner("/inbox/ack"),"={{ {id:$('Each message').item.json.id,lease:$('Each message').item.json.lease,text:$json.text||''} }}","BW Automation Runner");
  http(w,"Trigger immediate delivery",`={{ ${cfg("n8nBaseUrl")} + '/webhook/bw-notifications-deliver' }}`,"={{ {source:'sales-worker'} }}","BW Evolution Webhook");
  w.nodes.find(n=>n.name==="Trigger immediate delivery").onError="continueRegularOutput";
  link(w,"Every minute","Config");link(w,"Process now","Config");link(w,"Config","Claim inbox");link(w,"Claim inbox","Inbox items");link(w,"Inbox items","Each message");
  link(w,"Each message","Open session",1);link(w,"Open session","Is image");
  link(w,"Is image","Read Evolution media",0);link(w,"Read Evolution media","Check media limits");link(w,"Check media limits","Media usable");
  link(w,"Media usable","Submit private evidence",0);link(w,"Media usable","Validate evidence result",1);link(w,"Submit private evidence","Validate evidence result");
  link(w,"Is image","Prepare Typebot request",1);link(w,"Prepare Typebot request","Has Typebot session");
  link(w,"Has Typebot session","Continue Typebot",0);link(w,"Has Typebot session","Start Typebot",1);
  link(w,"Continue Typebot","Inspect continued session");link(w,"Inspect continued session","Session missing");
  link(w,"Session missing","Start Typebot",0);link(w,"Session missing","Validate Typebot response",1);link(w,"Start Typebot","Validate Typebot response");
  link(w,"Validate Typebot response","Session changed");link(w,"Session changed","Save Typebot session",0);link(w,"Session changed","Read Typebot reply",1);link(w,"Save Typebot session","Read Typebot reply");
  link(w,"Read Typebot reply","Finish inbox and queue reply");addEvidenceAnalysis(w);
  link(w,"Finish inbox and queue reply","Trigger immediate delivery");link(w,"Trigger immediate delivery","Each message");return w;
}
