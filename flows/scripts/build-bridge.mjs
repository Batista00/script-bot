import {workflow,node,link,http,configNode,backend,branch,credential,cfg} from "./workflow-helpers.mjs";
export function bridge(){
  const w=workflow("BW 02 — Typebot → ventas y asesoría OpenAI");
  node(w,"Typebot bridge","webhook",{httpMethod:"POST",path:"bw-sales-bridge",responseMode:"responseNode",options:{}});
  configNode(w);
  http(w,"Sales message",backend("/conversation/v1/message"),"={{ {messageId:$json.body.messageId,text:$json.body.text} }}",null,
    {sendHeaders:true,headerParameters:{parameters:[{name:"Authorization",value:"={{ $('Typebot bridge').first().json.headers.authorization }}"}]}});
  branch(w,"Needs advice","={{ Boolean($json.advice) }}");
  node(w,"OpenAI advisory","httpRequest",{method:"POST",url:"https://api.openai.com/v1/chat/completions",
    authentication:"predefinedCredentialType",nodeCredentialType:"openAiApi",sendBody:true,specifyBody:"json",
    jsonBody:`={{ {model:${cfg("openaiModel")},messages:[{role:'system',content:$json.advice.instructions},{role:'user',content:$json.advice.question}],max_completion_tokens:400,store:false} }}`,
    options:{timeout:25000}}, {...credential("openAiApi","OpenAI account"),onError:"continueRegularOutput"});
  node(w,"Advice or safe fallback","code",{jsCode:"const answer=$json.choices?.[0]?.message?.content; return [{json:{text:typeof answer==='string'&&answer.trim()?answer.trim().slice(0,2500):$('Sales message').first().json.text}}];"});
  node(w,"Reply","respondToWebhook",{respondWith:"json",responseBody:"={{ {text:$json.text || ''} }}",options:{}});
  link(w,"Typebot bridge","Config");link(w,"Config","Sales message");link(w,"Sales message","Needs advice");
  link(w,"Needs advice","OpenAI advisory",0);link(w,"Needs advice","Reply",1);
  link(w,"OpenAI advisory","Advice or safe fallback");link(w,"Advice or safe fallback","Reply");
  return w;
}
