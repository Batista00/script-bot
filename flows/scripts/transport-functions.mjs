// Kept as pure functions so transport normalization can be tested without live accounts.
export function normalizeEvolution(body,expectedInstance){
  if(!body || body.instance!==expectedInstance)throw new Error("EVOLUTION_INSTANCE_MISMATCH");
  if(!["messages.upsert","MESSAGES_UPSERT"].includes(body.event))return null;
  const data=body.data;const key=data?.key;
  if(!key || key.fromMe || !key.id)return null;
  const remote=String(key.remoteJid ?? "");
  if(remote.endsWith("@g.us") || remote==="status@broadcast")return null;
  const jid=remote.endsWith("@s.whatsapp.net") ? remote : String(key.remoteJidAlt ?? "");
  if(!/^[0-9]{8,15}(?::[0-9]+)?@s\.whatsapp\.net$/.test(jid))throw new Error("PHONE_IDENTITY_UNRESOLVED");
  const contact=jid.split("@")[0].split(":")[0];
  const message=data.message ?? {};
  const image=Boolean(message.imageMessage);
  const text=message.conversation ?? message.extendedTextMessage?.text ?? message.imageMessage?.caption ?? "";
  if(!image && !text)return null;
  return {contact,name:String(data.pushName||contact).slice(0,120),messageId:String(key.id).slice(0,128),text:String(text).slice(0,10000),image};
}
export function typebotText(response){
  function plain(value,topLevel=false){
    if(Array.isArray(value)){
      const parts=value.map(item=>plain(item,false)).filter(Boolean);
      return parts.join(topLevel?"\n":"");
    }
    if(!value || typeof value!=="object")return "";
    if(typeof value.text==="string")return value.text;
    if(value.type==="br")return "\n";
    return plain(value.children ?? value.content ?? [],false);
  }
  return (response.messages ?? []).filter(m=>m.type==="text")
    .map(m=>plain(m.content?.richText ?? [],true)).filter(Boolean).join("\n").replace(/\n{3,}/g,"\n\n").trim();
}

export function typebotMessages(response){
  return (response.messages??[]).filter(message=>message.type==="text")
    .flatMap(message=>typebotText({messages:[message]}).split(/\s*\|\|\|\s*/))
    .map(text=>text.trim()).filter(Boolean).slice(0,3);
}

export function encodeOutboxMessages(messages){
  const outboxPrefix="__BW_MESSAGES_V1__";
  const safe=(Array.isArray(messages)?messages:[]).map(text=>String(text).trim()).filter(Boolean).slice(0,3);
  if(!safe.length)return "";
  return safe.length===1 ? safe[0] : outboxPrefix+JSON.stringify(safe);
}

export function decodeOutboxMessages(value){
  const outboxPrefix="__BW_MESSAGES_V1__";
  const text=String(value??"");
  if(!text.startsWith(outboxPrefix))return text.trim() ? [text.trim()] : [];
  try {
    const messages=JSON.parse(text.slice(outboxPrefix.length));
    if(!Array.isArray(messages))throw new Error("OUTBOX_MESSAGES_INVALID");
    return messages.map(item=>String(item).trim()).filter(Boolean).slice(0,3);
  } catch {
    throw new Error("OUTBOX_MESSAGES_INVALID");
  }
}
