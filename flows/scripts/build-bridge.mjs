import {workflow,node,link,http,configNode,backend,branch} from "./workflow-helpers.mjs";

export function bridge(){
  const w=workflow("BW 02 — Typebot agente → backend comercial");
  node(w,"Typebot bridge","webhook",{httpMethod:"POST",path:"bw-sales-bridge",responseMode:"responseNode",options:{}},{webhookId:"f1fe0605-78ee-4267-849e-3945082592c2"});
  configNode(w);
  node(w,"Validate Typebot turn","code",{jsCode:`function parsePayload(value){
  if(value&&typeof value==='object')return value;
  if(typeof value!=='string'||!value)return null;
  try{return JSON.parse(value);}catch{}
  try{return JSON.parse(decodeURIComponent(value));}catch{return null;}
}
let body=$json.body??$json;
if(typeof body==='string')body=parsePayload(body);
if(!body||typeof body!=='object')body={};
const payload=parsePayload(body.payload)??body;
if(payload.mode && !['prepare','act'].includes(payload.mode))throw new Error('TYPEBOT_MODE_INVALID');
const inboxId=payload.inboxId,lease=payload.inboxLease;
if(!/^[0-9a-f-]{36}$/i.test(inboxId??'')||!/^[0-9a-f-]{36}$/i.test(lease??''))throw new Error('TYPEBOT_INBOX_PROOF_MISSING');
const mode=payload.mode==='act'?'act':'prepare';
const agentVersion=payload.agentVersion===2?2:1;
if(mode==='act'&&agentVersion!==2)throw new Error('TYPEBOT_AGENT_VERSION_INVALID');
const actionStep=Number(payload.actionStep??0);
if(mode==='act'&&(!Number.isInteger(actionStep)||actionStep<1||actionStep>3))throw new Error('TYPEBOT_ACTION_LIMIT');
const contact=String(payload.remoteJid??'').split('@')[0].split(':')[0].replace(/\\D/g,'');
if(!/^[0-9]{8,15}$/.test(contact))throw new Error('TYPEBOT_CONTACT_INVALID');
const pushName=typeof payload.pushName==='string'?payload.pushName.trim().slice(0,120):'';
const userMessage=typeof payload.userMessage==='string'?payload.userMessage.trim().slice(0,10000):'';
const messageId=typeof payload.messageId==='string'?payload.messageId.trim().slice(0,96):'';
if(!/^[A-Za-z0-9._:-]{1,96}$/.test(messageId))throw new Error('TYPEBOT_MESSAGE_ID_INVALID');
if(mode==='prepare'&&!userMessage)throw new Error('TYPEBOT_MESSAGE_MISSING');
const turnId=mode==='prepare'?'tb-'+String($execution.id):String(payload.turnId??'');
if(!/^tb-[A-Za-z0-9_-]{1,100}$/.test(turnId))throw new Error('TYPEBOT_TURN_ID_INVALID');
const decision=parsePayload(payload.decisionPayload)??payload.decision??null;
return [{json:{mode,agentVersion,contact,pushName,userMessage,messageId,turnId,decision,inboxId,lease,actionStep,
  catalogContext:typeof payload.catalogContext==='string'?payload.catalogContext.slice(0,6000):'',
  actionCompleted:payload.actionCompleted==='yes'?'yes':'no'}}];`});
  http(w,"Open current sales session",backend("/bot/v1/sales/sessions"),
    "={{ {inboxId:$json.inboxId,lease:$json.lease} }}","BW Backend");
  branch(w,"Is agent action","={{ $('Validate Typebot turn').item.json.mode === 'act' }}");
  node(w,"Prepare conversational turn","code",{jsCode:`const turn=$('Validate Typebot turn').item.json;
return [{json:{
  userMessage:turn.userMessage,messageId:turn.messageId,turnId:turn.turnId,operationResult:'',catalogContext:turn.catalogContext,
  remoteJid:turn.contact,pushName:turn.pushName,actionCompleted:'no',continueAgent:'yes',assistantMessage:'',action:'responder'
}}];`});
  node(w,"Resolve agent decision","code",{jsCode:`const original=$('Open current sales session').item.json.incomingMessage;
if(!original||typeof original.text!=='string'||typeof original.messageId!=='string')throw new Error('CANONICAL_MESSAGE_MISSING');
const turn={...$('Validate Typebot turn').item.json,userMessage:original.text,messageId:original.messageId,contact:original.contact,pushName:original.name||''};
let decision=turn.decision;
if(typeof decision==='string'){
  let clean=decision.trim();const fence=String.fromCharCode(96).repeat(3);
  if(clean.startsWith(fence))clean=clean.slice(3).replace(/^json\\s*/i,'');
  if(clean.endsWith(fence))clean=clean.slice(0,-3).trim();
  try{decision=JSON.parse(clean);}catch{decision=null;}
}
const allowed=new Set(['catalog','select','input','delivery','confirm','payment','status','new_purchase','add_item','remove_item','handoff']);
if(turn.mode==='act'&&!allowed.has(decision?.action))throw new Error('TYPEBOT_DECISION_INVALID');
const action=turn.mode==='prepare'?'prepare':decision.action;
const text=value=>typeof value==='string'?value.trim().slice(0,1000):'';
const number=Number.isSafeInteger(Number(decision?.quantity))&&Number(decision.quantity)>0?Number(decision.quantity):null;
const category=text(decision?.category),product=text(decision?.product),targetUrl=text(decision?.target_url);
const paymentMethod=text(decision?.payment_method),humanHandoffReason=text(decision?.human_handoff_reason);
const backendText=turn.userMessage;
const requiresBackend=true;
return [{json:{...turn,action,category,product,quantity:number,targetUrl,paymentMethod,humanHandoffReason,
  assistantMessage:'',backendText,requiresBackend,decision:turn.mode==='act'?decision:null,
  messageId:turn.agentVersion===2?(turn.messageId+':agent:'+String(turn.actionStep??0)).slice(0,128):turn.messageId}}];`});
  branch(w,"Requires backend","={{ $json.requiresBackend === true }}");
  node(w,"Return safe fallback","code",{jsCode:`const requested=$('Resolve agent decision').item.json;
return [{json:{assistantMessage:requested.action==='responder'?'¿En qué servicio te puedo ayudar?':'Necesito un dato más para continuar. ¿Puedes indicármelo?',
  action:requested.action,operationResult:'',catalogContext:requested.catalogContext,category:requested.category,product:requested.product,
  quantity:requested.quantity,retailPrice:'',productId:'',targetUrl:requested.targetUrl,orderId:'',orderStatus:'',
  paymentMethod:requested.paymentMethod,paymentStatus:'',humanHandoffReason:requested.humanHandoffReason,
  continueAgent:'no',actionCompleted:'yes',turnId:requested.turnId}}];`});
  http(w,"Execute authorized operation",`={{ ${"$('Config').first().json.config.backendBaseUrl"} + ($json.mode === 'prepare' && $json.agentVersion === 2 ? '/conversation/v1/prepare' : '/conversation/v1/message') }}`,"={{ {messageId:$json.messageId,text:$json.backendText,presentation:'typebot',...($json.mode === 'act' ? {decision:$json.decision} : {})} }}",null,
    {sendHeaders:true,headerParameters:{parameters:[{name:"Authorization",value:"={{ 'Bearer ' + $('Open current sales session').item.json.sessionToken }}"}]},
      options:{timeout:60000,redirect:{redirect:{followRedirects:false}},response:{response:{neverError:true,fullResponse:true,responseFormat:"json"}}}});
  node(w,"Prepare authorized result","code",{jsCode:`const statusCode=Number($json.statusCode??200);
const candidate=$json.body&&typeof $json.body==='object'?$json.body:$json;
if(statusCode<200||statusCode>=300)throw new Error('BACKEND_CONVERSATION_HTTP_'+statusCode);
if(typeof candidate.text!=='string')throw new Error('BACKEND_CONVERSATION_RESPONSE_INVALID');
const source=typeof candidate?.text==='string'?candidate.text:'';
const clean=source.split(/\\r?\\n/)
  .filter(line=>!/^\\s*(?:Escribe|También puedes escribir|Para comprar,|Elige una opción o|MÁS|BUSCAR|HUMANO|BAJA)\\b/i.test(line))
  .map(line=>line.replace(/^\\s*\\d+\\.\\s*/, '').replace(/\\s*\\(\\d+\\s*[–-]\\s*\\d+\\)\\s*/g,' ').trim())
  .filter(Boolean).join('\\n');
const requested=$('Resolve agent decision').item.json;
const contextFields={userMessage:requested.userMessage,remoteJid:requested.contact,pushName:requested.pushName,
  businessContext:JSON.stringify(candidate.context??{}),backendReady:'yes',replyAllowed:candidate.paused && !candidate.text?'no':'yes'};
if(candidate.paused && !candidate.text)return [{json:{...contextFields,operationResult:'',actionCompleted:'yes'}}];
if(statusCode<200||statusCode>=300||!clean){return [{json:{assistantMessage:'No pude completar esa operación ahora. ¿Quieres intentarlo nuevamente o hablar con una persona?',
  action:requested.action,operationResult:'',catalogContext:requested.catalogContext,category:requested.category,product:requested.product,
  quantity:requested.quantity,retailPrice:'',productId:'',targetUrl:requested.targetUrl,orderId:'',orderStatus:'',
  paymentMethod:requested.paymentMethod,paymentStatus:'',humanHandoffReason:requested.humanHandoffReason,
  continueAgent:'no',actionCompleted:'yes',turnId:requested.turnId}}];}
const order=/\\bPedido\\s+([A-Za-z0-9-]{6,64})/i.exec(source)?.[1]||'';
const amount=/(?:Total|valor)(?:\\s+pedido)?\\s*:?\\s*([^\\n]+)/i.exec(source)?.[1]?.trim()||'';
const isCatalog=requested.action==='catalog';
return [{json:{...contextFields,assistantMessage:'',action:requested.action,operationResult:clean,
  catalogContext:isCatalog?clean:requested.catalogContext,category:requested.category,product:requested.product,
  quantity:requested.quantity,retailPrice:amount,productId:'',targetUrl:requested.targetUrl,orderId:order,orderStatus:'',
  paymentMethod:requested.paymentMethod,paymentStatus:'',humanHandoffReason:requested.humanHandoffReason,
  continueAgent:'yes',actionCompleted:'yes',turnId:requested.turnId}}];`});
  node(w,"Reply","respondToWebhook",{respondWith:"json",responseBody:"={{ {data:$json} }}",options:{}});

  link(w,"Typebot bridge","Config");link(w,"Config","Validate Typebot turn");
  link(w,"Validate Typebot turn","Open current sales session");link(w,"Open current sales session","Is agent action");
  link(w,"Is agent action","Resolve agent decision",0);link(w,"Is agent action","Resolve agent decision",1);
  link(w,"Resolve agent decision","Requires backend");
  link(w,"Requires backend","Execute authorized operation",0);link(w,"Requires backend","Return safe fallback",1);
  link(w,"Execute authorized operation","Prepare authorized result");link(w,"Prepare authorized result","Reply");link(w,"Return safe fallback","Reply");
  return w;
}
