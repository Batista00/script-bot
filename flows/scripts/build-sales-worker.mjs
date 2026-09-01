import {workflow,node,link,http,configNode,backend,runner,branch,cfg,scopedHeaders} from "./workflow-helpers.mjs";
import {typebotText} from "./transport-functions.mjs";
import {addEvidenceAnalysis} from "./build-evidence-analysis.mjs";
import {evidenceResponse} from "./evidence-response.mjs";
export function salesWorker(){
  const w=workflow("BW 03 — Procesar ventas y comprobantes");
  node(w,"Every 5 seconds","scheduleTrigger",{rule:{interval:[{field:"seconds",secondsInterval:5}]}});
  configNode(w);
  http(w,"Claim inbox",runner("/inbox/claim"),"{}","BW Automation Runner");
  node(w,"Inbox items","code",{jsCode:"return ($json.items||[]).map(item=>({json:item}));"});
  node(w,"Each message","splitInBatches",{batchSize:1,options:{}});
  http(w,"Open session",backend("/bot/v1/sales/sessions"),"={{ {contact:$json.contact,name:$json.payload.name} }}","BW Backend");
  branch(w,"Is image","={{ $('Each message').item.json.payload.image }}");
  http(w,"Read Evolution media",`={{ ${cfg("evolutionBaseUrl")} + '/chat/getBase64FromMediaMessage/' + encodeURIComponent(${cfg("instance")}) }}`,
    "={{ {message:{key:{id:$('Each message').item.json.payload.messageId,remoteJid:$('Each message').item.json.contact+'@s.whatsapp.net',fromMe:false}},convertToMp4:false} }}","Evolution API");
  node(w,"Check media limits","code",{jsCode:"const valid=typeof $json.base64==='string'&&$json.base64.length<=2800000&&['image/jpeg','image/png'].includes($json.mimetype);return [{json:valid?{...$json,valid}:{valid,error:{code:'INVALID_PAYMENT_EVIDENCE'}}}];"});
  branch(w,"Media usable","={{ $json.valid }}");
  http(w,"Submit private evidence",backend("/conversation/v1/evidence"),"={{ {base64:$json.base64,mimeType:$json.mimetype} }}",null,
    {...scopedHeaders,options:{timeout:60000,redirect:{redirect:{followRedirects:false}},response:{response:{neverError:true}}}});
  node(w,"Validate evidence result","code",{jsCode:`${evidenceResponse.toString()}\nreturn [{json:evidenceResponse($json)}];`});
  node(w,"Prepare Typebot start","code",{jsCode:`const opened=$('Open session').first().json;
const payload=$('Each message').first().json.payload;
if(typeof opened.sessionToken!=='string'||!/^cs_[A-Za-z0-9_-]{43}$/.test(opened.sessionToken))throw new Error('SALES_SESSION_TOKEN_MISSING');
if(typeof payload?.messageId!=='string'||typeof payload?.text!=='string')throw new Error('SALES_MESSAGE_CONTEXT_MISSING');
return [{json:{prefilledVariables:{session_token:opened.sessionToken,message_id:payload.messageId,customer_message:payload.text}}}];`});
  http(w,"Run Typebot",`={{ ${cfg("typebotBaseUrl")} + '/api/v1/typebots/' + encodeURIComponent(${cfg("typebotPublicId")}) + '/startChat' }}`,
    "={{ $json }}",null);
  node(w,"Read Typebot reply","code",{jsCode:`${typebotText.toString()}\nconst text=typebotText($json);if(!Array.isArray($json.messages))throw new Error('TYPEBOT_INVALID_RESPONSE');return [{json:{text}}];`});
  http(w,"Finish inbox and queue reply",runner("/inbox/ack"),"={{ {id:$('Each message').item.json.id,lease:$('Each message').item.json.lease,text:$json.text||''} }}","BW Automation Runner");
  link(w,"Every 5 seconds","Config");link(w,"Config","Claim inbox");link(w,"Claim inbox","Inbox items");link(w,"Inbox items","Each message");
  link(w,"Each message","Open session",1);link(w,"Open session","Is image");
  link(w,"Is image","Read Evolution media",0);link(w,"Read Evolution media","Check media limits");link(w,"Check media limits","Media usable");
  link(w,"Media usable","Submit private evidence",0);link(w,"Media usable","Validate evidence result",1);link(w,"Submit private evidence","Validate evidence result");
  link(w,"Is image","Prepare Typebot start",1);link(w,"Prepare Typebot start","Run Typebot");link(w,"Run Typebot","Read Typebot reply");
  link(w,"Read Typebot reply","Finish inbox and queue reply");addEvidenceAnalysis(w);
  link(w,"Finish inbox and queue reply","Each message");return w;
}
