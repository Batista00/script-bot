import {workflow,node,link,http,configNode,runner,branch,cfg,credential,source} from "./workflow-helpers.mjs";
import {decodeOutboxMessages} from "./transport-functions.mjs";
export function notifications(){
  const w=workflow("BW 04 — Pagos, entregas y notificaciones durables");
  node(w,"Every minute","scheduleTrigger",{rule:{interval:[{field:"minutes",minutesInterval:1}]}});
  node(w,"Deliver now","webhook",{httpMethod:"POST",path:"bw-notifications-deliver",authentication:"headerAuth",responseMode:"onReceived",options:{}},{...credential("httpHeaderAuth","BW Evolution Webhook"),webhookId:"e2a728f3-f39c-457c-b66a-3f3643e34085"});
  configNode(w);
  http(w,"Reconcile paid orders",runner("/tick"),"{}","BW Automation Runner");
  http(w,"Claim notifications",runner("/notifications/claim"),"{}","BW Automation Runner");
  node(w,"Notification items","code",{jsCode:"return ($json.items||[]).map(item=>({json:item}));"});
  node(w,"Each notification","splitInBatches",{batchSize:1,options:{}});
  branch(w,"Is WhatsApp","={{ $json.channel === 'whatsapp' }}");
  node(w,"Expand WhatsApp bubbles","code",{jsCode:`${source(decodeOutboxMessages)}
const notification=$json;
const messages=decodeOutboxMessages(notification.payload?.text);
if(!messages.length)throw new Error('WHATSAPP_EMPTY_MESSAGE');
return messages.map((text,index)=>({json:{...notification,whatsappText:text,whatsappDelay:600+index*150}}));`});
  http(w,"Send WhatsApp",`={{ ${cfg("evolutionBaseUrl")} + '/message/sendText/' + encodeURIComponent(${cfg("instance")}) }}`,
    "={{ {number:$json.payload.contact,text:$json.whatsappText,delay:$json.whatsappDelay} }}","Evolution API");
  node(w,"Verify WhatsApp result","code",{jsCode:"const sent=$input.all();if(!sent.length||sent.some(item=>!item.json.key?.id))throw new Error('EVOLUTION_SEND_UNCONFIRMED');return [{json:{ok:true,count:sent.length}}];"});
  node(w,"Prepare Telegram","code",{jsCode:`const item=$json;
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const original=String(item.payload.text||'');
const evidence=item.payload.evidence;
const analysis=evidence?.analysis&&typeof evidence.analysis==='object'?evidence.analysis:null;
if(evidence){
  const order=/Pedido\\s+([^\\n]+)/i.exec(original)?.[1]||'sin referencia';
  const expected=/Esperado:\\s*([^\\n]+)/i.exec(original)?.[1]||'por verificar';
  const customer=/Cliente:\\s*([^\\n]+)/i.exec(original)?.[1]||'no informado';
  const read=analysis?.amount&&analysis?.currency?[analysis.amount,analysis.currency].join(' '):'ilegible';
  const match=read===expected;
  item.telegramText=[
    '🟢 <b>COMPROBANTE RECIBIDO</b>','',
    '🧾 Pedido: '+escape(order),'📱 Cliente: '+escape(customer),'💰 Total pedido: '+escape(expected),'💸 Transferido: '+escape(read),
    '',match?'✅ MONTO COINCIDE':'⚠️ MONTO POR REVISAR',
    '', '🔢 Operación: '+escape(analysis?.bankReference||'ilegible'),'👤 Destinatario leído: '+escape(analysis?.recipient||'ilegible'),
    '🤖 '+escape(analysis?.observations||'Lectura automática no disponible.'),'','⛔ <b>El pago todavía NO está confirmado.</b>',
    'Verifica el abono en tu banco antes de aprobar.',
  ].join('\\n');
}else item.telegramText=escape(original);
return [{json:item,...(evidence?{binary:{data:{data:evidence.base64,mimeType:evidence.mimeType,fileName:evidence.mimeType==='image/png'?'comprobante.png':'comprobante.jpg'}}}:{})}];`});
  branch(w,"Has evidence","={{ Boolean($json.payload.evidence) }}");
  const tg=credential("telegramApi","Telegram Ventas Admin");
  node(w,"Send Telegram text","telegram",{resource:"message",operation:"sendMessage",chatId:"={{ $json.payload.chatId }}",text:"={{ $json.telegramText }}",replyMarkup:"none",additionalFields:{parse_mode:"HTML",appendAttribution:false,protect_content:true}},tg);
  node(w,"Send Telegram evidence","telegram",{resource:"message",operation:"sendPhoto",chatId:"={{ $json.payload.chatId }}",binaryData:true,binaryPropertyName:"data",replyMarkup:"inlineKeyboard",
    inlineKeyboard:"={{ {rows:$json.payload.replyMarkup.inline_keyboard.map(row=>({row:{buttons:row.map(button=>({text:button.text==='Verificar y aprobar'?'✅ APROBAR PAGO':button.text==='Rechazar comprobante'?'❌ RECHAZAR PAGO':'👁 VER INFORMACIÓN',additionalFields:{callback_data:button.callback_data}}))}}))} }}",
    additionalFields:{caption:"={{ $json.telegramText.slice(0,1000) }}",parse_mode:"HTML",protect_content:true}},tg);
  http(w,"Acknowledge delivered",runner("/notifications/ack"),"={{ {id:$('Each notification').item.json.id,lease:$('Each notification').item.json.lease,success:true} }}","BW Automation Runner");
  link(w,"Every minute","Config");link(w,"Deliver now","Config");link(w,"Config","Reconcile paid orders");link(w,"Reconcile paid orders","Claim notifications");link(w,"Claim notifications","Notification items");link(w,"Notification items","Each notification");
  link(w,"Each notification","Is WhatsApp",1);link(w,"Is WhatsApp","Expand WhatsApp bubbles",0);link(w,"Expand WhatsApp bubbles","Send WhatsApp");link(w,"Send WhatsApp","Verify WhatsApp result");link(w,"Verify WhatsApp result","Acknowledge delivered");
  link(w,"Is WhatsApp","Prepare Telegram",1);link(w,"Prepare Telegram","Has evidence");link(w,"Has evidence","Send Telegram evidence",0);link(w,"Has evidence","Send Telegram text",1);
  link(w,"Send Telegram text","Acknowledge delivered");link(w,"Send Telegram evidence","Acknowledge delivered");link(w,"Acknowledge delivered","Each notification");return w;
}
