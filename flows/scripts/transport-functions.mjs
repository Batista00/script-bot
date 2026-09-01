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
  function plain(value){
    if(Array.isArray(value))return value.map(plain).join("");
    if(!value || typeof value!=="object")return "";
    if(typeof value.text==="string")return value.text;
    const result=plain(value.children ?? value.content ?? []);
    return value.type==="p" ? result+"\n" : result;
  }
  return (response.messages ?? []).filter(m=>m.type==="text").map(m=>plain(m.content?.richText ?? [])).join("\n").trim();
}
