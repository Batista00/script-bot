import {workflow,node,link,http,configNode,runner,branch,cfg,credential} from "./workflow-helpers.mjs";
export function notifications(){
  const w=workflow("BW 04 — Pagos, entregas y notificaciones durables");
  node(w,"Every minute","scheduleTrigger",{rule:{interval:[{field:"minutes",minutesInterval:1}]}});
  configNode(w);
  http(w,"Reconcile paid orders",runner("/tick"),"{}","BW Automation Runner");
  http(w,"Claim notifications",runner("/notifications/claim"),"{}","BW Automation Runner");
  node(w,"Notification items","code",{jsCode:"return ($json.items||[]).map(item=>({json:item}));"});
  node(w,"Each notification","splitInBatches",{batchSize:1,options:{}});
  branch(w,"Is WhatsApp","={{ $json.channel === 'whatsapp' }}");
  http(w,"Send WhatsApp",`={{ ${cfg("evolutionBaseUrl")} + '/message/sendText/' + encodeURIComponent(${cfg("instance")}) }}`,
    "={{ {number:$json.payload.contact,text:$json.payload.text} }}","Evolution API");
  node(w,"Verify WhatsApp result","code",{jsCode:"if(!$json.key?.id)throw new Error('EVOLUTION_SEND_UNCONFIRMED');return $input.all();"});
  node(w,"Prepare Telegram","code",{jsCode:"const item=$json;const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');item.telegramText=escape(item.payload.text||'');const evidence=item.payload.evidence;return [{json:item,...(evidence?{binary:{data:{data:evidence.base64,mimeType:evidence.mimeType,fileName:evidence.mimeType==='image/png'?'comprobante.png':'comprobante.jpg'}}}:{})}];"});
  branch(w,"Has evidence","={{ Boolean($json.payload.evidence) }}");
  const tg=credential("telegramApi","Telegram Ventas Admin");
  node(w,"Send Telegram text","telegram",{resource:"message",operation:"sendMessage",chatId:"={{ $json.payload.chatId }}",text:"={{ $json.telegramText }}",replyMarkup:"none",additionalFields:{parse_mode:"HTML",appendAttribution:false,protect_content:true}},tg);
  node(w,"Send Telegram evidence","telegram",{resource:"message",operation:"sendPhoto",chatId:"={{ $json.payload.chatId }}",binaryData:true,binaryPropertyName:"data",replyMarkup:"inlineKeyboard",
    inlineKeyboard:"={{ {rows:$json.payload.replyMarkup.inline_keyboard.map(row=>({row:{buttons:row.map(button=>({text:button.text,additionalFields:{callback_data:button.callback_data}}))}}))} }}",
    additionalFields:{caption:"={{ $json.telegramText.slice(0,1000) }}",parse_mode:"HTML",protect_content:true}},tg);
  http(w,"Acknowledge delivered",runner("/notifications/ack"),"={{ {id:$('Each notification').item.json.id,lease:$('Each notification').item.json.lease,success:true} }}","BW Automation Runner");
  link(w,"Every minute","Config");link(w,"Config","Reconcile paid orders");link(w,"Reconcile paid orders","Claim notifications");link(w,"Claim notifications","Notification items");link(w,"Notification items","Each notification");
  link(w,"Each notification","Is WhatsApp",1);link(w,"Is WhatsApp","Send WhatsApp",0);link(w,"Send WhatsApp","Verify WhatsApp result");link(w,"Verify WhatsApp result","Acknowledge delivered");
  link(w,"Is WhatsApp","Prepare Telegram",1);link(w,"Prepare Telegram","Has evidence");link(w,"Has evidence","Send Telegram evidence",0);link(w,"Has evidence","Send Telegram text",1);
  link(w,"Send Telegram text","Acknowledge delivered");link(w,"Send Telegram evidence","Acknowledge delivered");link(w,"Acknowledge delivered","Each notification");return w;
}
