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
const mode=payload.mode==='act'?'act':'prepare';
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
return [{json:{mode,contact,pushName,userMessage,messageId,turnId,decision,
  catalogContext:typeof payload.catalogContext==='string'?payload.catalogContext.slice(0,6000):'',
  actionCompleted:payload.actionCompleted==='yes'?'yes':'no'}}];`});
  http(w,"Open current sales session",backend("/bot/v1/sales/sessions"),
    "={{ {contact:$json.contact,...($json.pushName?{name:$json.pushName}:{})} }}","BW Backend");
  branch(w,"Is agent action","={{ $('Validate Typebot turn').item.json.mode === 'act' }}");
  node(w,"Prepare conversational turn","code",{jsCode:`const turn=$('Validate Typebot turn').item.json;
return [{json:{
  userMessage:turn.userMessage,messageId:turn.messageId,turnId:turn.turnId,operationResult:'',catalogContext:turn.catalogContext,
  remoteJid:turn.contact,pushName:turn.pushName,actionCompleted:'no',continueAgent:'yes',assistantMessage:'',action:'responder'
}}];`});
  node(w,"Resolve agent decision","code",{jsCode:`const turn=$('Validate Typebot turn').item.json;
let decision=turn.decision;
if(typeof decision==='string'){
  let clean=decision.trim();const fence=String.fromCharCode(96).repeat(3);
  if(clean.startsWith(fence))clean=clean.slice(3).replace(/^json\\s*/i,'');
  if(clean.endsWith(fence))clean=clean.slice(0,-3).trim();
  try{decision=JSON.parse(clean);}catch{decision=null;}
}
const allowed=new Set(['responder','consultar_catalogo','seleccionar_producto','capturar_destino','crear_pedido','elegir_pago','consultar_pedido','derivar_humano']);
const action=turn.mode==='prepare'?'procesar_mensaje':(allowed.has(decision?.action)?decision.action:'responder');
const text=value=>typeof value==='string'?value.trim().slice(0,1000):'';
const number=Number.isSafeInteger(Number(decision?.quantity))&&Number(decision.quantity)>0?Number(decision.quantity):null;
const category=text(decision?.category),product=text(decision?.product),targetUrl=text(decision?.target_url);
const paymentMethod=text(decision?.payment_method),humanHandoffReason=text(decision?.human_handoff_reason);
let backendText='';
if(action==='procesar_mensaje') backendText=turn.userMessage;
if(action==='consultar_catalogo') backendText=['buscar',category,product,number].filter(Boolean).join(' ').trim();
if(action==='seleccionar_producto') backendText=number?String(number):['buscar',category,product].filter(Boolean).join(' ').trim();
if(action==='capturar_destino') backendText=/^https?:\\/\\/[^\\s]+$/i.test(targetUrl)?targetUrl:'';
if(action==='crear_pedido') backendText='si';
if(action==='elegir_pago') backendText=paymentMethod||'transferencia';
if(action==='consultar_pedido') backendText='estado';
if(action==='derivar_humano') backendText='humano';
const requiresBackend=action!=='responder'&&turn.actionCompleted!=='yes'&&Boolean(backendText);
return [{json:{...turn,action,category,product,quantity:number,targetUrl,paymentMethod,humanHandoffReason,
  assistantMessage:'',backendText,requiresBackend,messageId:(turn.messageId+':'+action).slice(0,128)}}];`});
  branch(w,"Requires backend","={{ $json.requiresBackend === true }}");
  node(w,"Return safe fallback","code",{jsCode:`const requested=$('Resolve agent decision').item.json;
return [{json:{assistantMessage:requested.action==='responder'?'¿En qué servicio te puedo ayudar?':'Necesito un dato más para continuar. ¿Puedes indicármelo?',
  action:requested.action,operationResult:'',catalogContext:requested.catalogContext,category:requested.category,product:requested.product,
  quantity:requested.quantity,retailPrice:'',productId:'',targetUrl:requested.targetUrl,orderId:'',orderStatus:'',
  paymentMethod:requested.paymentMethod,paymentStatus:'',humanHandoffReason:requested.humanHandoffReason,
  continueAgent:'no',actionCompleted:'yes',turnId:requested.turnId}}];`});
  http(w,"Execute authorized operation",backend("/conversation/v1/message"),"={{ {messageId:$json.messageId,text:$json.backendText} }}",null,
    {sendHeaders:true,headerParameters:{parameters:[{name:"Authorization",value:"={{ 'Bearer ' + $('Open current sales session').item.json.sessionToken }}"}]},
      options:{timeout:60000,redirect:{redirect:{followRedirects:false}},response:{response:{neverError:true,fullResponse:true,responseFormat:"json"}}}});
  node(w,"Prepare authorized result","code",{jsCode:`const statusCode=Number($json.statusCode??200);
const candidate=$json.body&&typeof $json.body==='object'?$json.body:$json;
const source=typeof candidate?.text==='string'?candidate.text:'';
const clean=source.split(/\\r?\\n/)
  .filter(line=>!/^\\s*(?:Escribe|También puedes escribir|Para comprar,|Elige una opción o|MÁS|BUSCAR|HUMANO|BAJA)\\b/i.test(line))
  .map(line=>line.replace(/^\\s*\\d+\\.\\s*/, '').replace(/\\s*\\(\\d+\\s*[–-]\\s*\\d+\\)\\s*/g,' ').trim())
  .filter(Boolean).slice(0,12).join('\\n').slice(0,6000);
const requested=$('Resolve agent decision').item.json;
if(statusCode<200||statusCode>=300||!clean){return [{json:{assistantMessage:'No pude completar esa operación ahora. ¿Quieres intentarlo nuevamente o hablar con una persona?',
  action:requested.action,operationResult:'',catalogContext:requested.catalogContext,category:requested.category,product:requested.product,
  quantity:requested.quantity,retailPrice:'',productId:'',targetUrl:requested.targetUrl,orderId:'',orderStatus:'',
  paymentMethod:requested.paymentMethod,paymentStatus:'',humanHandoffReason:requested.humanHandoffReason,
  continueAgent:'no',actionCompleted:'yes',turnId:requested.turnId}}];}
const order=/\\bPedido\\s+([A-Za-z0-9-]{6,64})/i.exec(source)?.[1]||'';
const amount=/(?:Total|valor)(?:\\s+pedido)?\\s*:?\\s*([^\\n]+)/i.exec(source)?.[1]?.trim()||'';
const isCatalog=requested.action==='consultar_catalogo';
return [{json:{assistantMessage:'',action:requested.action,operationResult:clean,
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
