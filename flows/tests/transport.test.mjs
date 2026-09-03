import assert from "node:assert/strict";
import { test } from "node:test";
import { evidenceResponse } from "../scripts/evidence-response.mjs";

test("invalid evidence replies do not block the contact; technical failures still retry",()=>{
  assert.equal(evidenceResponse({error:{code:"INVALID_PAYMENT_EVIDENCE"}}).reviewId,null);
  assert.match(evidenceResponse({error:{code:"PAYMENT_REQUIRED"}}).text,/transferencia/);
  assert.deepEqual(evidenceResponse({reviewId:"fixture",text:"Recibido"}),{reviewId:"fixture",text:"Recibido"});
  assert.throws(()=>evidenceResponse({error:{code:"INTERNAL_SERVER_ERROR",message:"private details"}}),/EVIDENCE_SERVICE_UNAVAILABLE/);
});
import { normalizeEvolution,typebotText,typebotMessages,encodeOutboxMessages,decodeOutboxMessages } from "../scripts/transport-functions.mjs";
const event={event:"messages.upsert",instance:"fixture",data:{key:{remoteJid:"56912345678@s.whatsapp.net",id:"ABC",fromMe:false},pushName:"Cliente",message:{conversation:"Hola"}}};
test("Evolution 2.3.4 incoming identity is normalized and body credentials are not copied",()=>{
  assert.deepEqual(normalizeEvolution({...event,apikey:"DO_NOT_COPY"},"fixture"),{contact:"56912345678",name:"Cliente",messageId:"ABC",text:"Hola",image:false});
});
test("wrong instance, own messages, groups and unresolved LID cannot create customer conversations",()=>{
  assert.throws(()=>normalizeEvolution(event,"foreign"));
  assert.equal(normalizeEvolution({...event,data:{...event.data,key:{...event.data.key,fromMe:true}}},"fixture"),null);
  assert.equal(normalizeEvolution({...event,data:{...event.data,key:{...event.data.key,remoteJid:"123@g.us"}}},"fixture"),null);
  assert.throws(()=>normalizeEvolution({...event,data:{...event.data,key:{...event.data.key,remoteJid:"123@lid"}}},"fixture"));
});
test("Typebot rich text is translated to WhatsApp without HTML evaluation",()=>{
  assert.equal(typebotText({messages:[{type:"text",content:{richText:[{type:"p",children:[{text:"Hola "},{text:"cliente"}]}]}}]}),"Hola cliente");
});
test("Typebot keeps catalog rows separated for WhatsApp",()=>{
  const response={messages:[{type:"text",content:{richText:[
    {children:[{text:"Encontré estas opciones:"}]},
    {children:[{text:"1. 500 seguidores — 1.990 CLP"}]},
    {children:[{text:"2. 1.000 seguidores — 4.990 CLP"}]},
  ]}}]};
  assert.equal(typebotText(response),
    "Encontré estas opciones:\n1. 500 seguidores — 1.990 CLP\n2. 1.000 seguidores — 4.990 CLP");
});
test("Typebot text blocks and explicit bubble delimiters remain separate and ordered",()=>{
  const response={messages:[
    {type:"text",content:{richText:[{children:[{text:"Perfecto 😊"}]}]}},
    {type:"text",content:{richText:[{children:[{text:"1. Opción — 1.990 CLP\n2. Opción — 4.990 CLP|||¿Cuál prefieres?"}]}]}},
  ]};
  assert.deepEqual(typebotMessages(response),["Perfecto 😊","1. Opción — 1.990 CLP\n2. Opción — 4.990 CLP","¿Cuál prefieres?"]);
  const encoded=encodeOutboxMessages(typebotMessages(response));
  assert.deepEqual(decodeOutboxMessages(encoded),typebotMessages(response));
  assert.deepEqual(decodeOutboxMessages("Respuesta anterior compatible"),["Respuesta anterior compatible"]);
});
test("invalid versioned outbox payload is rejected instead of silently dropping messages",()=>{
  assert.throws(()=>decodeOutboxMessages("__BW_MESSAGES_V1__not-json"),/OUTBOX_MESSAGES_INVALID/);
});
