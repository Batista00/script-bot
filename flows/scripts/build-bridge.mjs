import {workflow,node,link,http,configNode,backend} from "./workflow-helpers.mjs";
export function bridge(){
  const w=workflow("BW 02 — Typebot → backend comercial");
  node(w,"Typebot bridge","webhook",{httpMethod:"POST",path:"bw-sales-bridge",responseMode:"responseNode",options:{}},{webhookId:"f1fe0605-78ee-4267-849e-3945082592c2"});
  configNode(w);
  node(w,"Validate sales turn","code",{jsCode:`const body=$json.body&&typeof $json.body==='object'?$json.body:{};
const sessionToken=typeof body.sessionToken==='string'?body.sessionToken:'';
if(!/^cs_[A-Za-z0-9_-]{43}$/.test(sessionToken))throw new Error('SALES_TURN_TOKEN_MISSING');
if(typeof body.messageId!=='string'||!body.messageId||typeof body.text!=='string')throw new Error('SALES_TURN_CONTEXT_MISSING');
return [{json:{messageId:body.messageId,text:body.text,authorization:'Bearer '+sessionToken}}];`});
  http(w,"Sales message",backend("/conversation/v1/message"),"={{ {messageId:$json.messageId,text:$json.text} }}",null,
    {sendHeaders:true,headerParameters:{parameters:[{name:"Authorization",value:"={{ $json.authorization }}"}]},
      options:{timeout:60000,redirect:{redirect:{followRedirects:false}},
        response:{response:{neverError:true,fullResponse:true,responseFormat:"json"}}}});
  node(w,"Prepare safe response","code",{jsCode:`const statusCode=Number($json.statusCode??200);
const candidate=$json.body&&typeof $json.body==='object'?$json.body:
  $json.response&&typeof $json.response==='object'?$json.response:$json;
const successful=statusCode>=200&&statusCode<300&&candidate&&typeof candidate==='object';
const reply=successful?candidate:{};
const advice=reply.advice&&typeof reply.advice==='object'?reply.advice:null;
const fallback='No pude completar esa consulta en este momento. Puedo intentarlo nuevamente o derivarte con una persona.';
const hasText=typeof reply.text==='string'&&reply.text.trim().length>0;
const text=hasText?reply.text.trim():fallback;
const customerText=$('Validate sales turn').item.json.text;
const authorizedContext=[text,advice?String(advice.instructions||''):''].filter(Boolean).join('\\n\\n').slice(0,6000);
return [{json:{
  text,
  needsAi:successful&&hasText&&reply.paused!==true?'yes':'no',
  aiContext:successful&&hasText?authorizedContext:'',
  aiQuestion:(advice&&typeof advice.question==='string'&&advice.question.trim()?advice.question:customerText).slice(0,2000)
}}];`});
  node(w,"Reply","respondToWebhook",{respondWith:"json",responseBody:"={{ $json }}",options:{}});
  link(w,"Typebot bridge","Config");link(w,"Config","Validate sales turn");link(w,"Validate sales turn","Sales message");
  link(w,"Sales message","Prepare safe response");link(w,"Prepare safe response","Reply");
  return w;
}
