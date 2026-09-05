export function typebotEnvelope(opened,payload){
  if(typeof opened?.sessionToken!=="string"||!/^cs_[A-Za-z0-9_-]{43}$/.test(opened.sessionToken))
    throw new Error("SALES_SESSION_TOKEN_MISSING");
  if(typeof payload?.messageId!=="string"||typeof payload?.text!=="string")
    throw new Error("SALES_MESSAGE_CONTEXT_MISSING");
  return encodeURIComponent(JSON.stringify({
    messageId:payload.messageId,
    text:payload.text,
    remoteJid:payload.contact,
    pushName:typeof payload.name==="string"?payload.name:"",
  }));
}

export function typebotRequest(baseUrl,publicId,typebotSessionId,envelope){
  const root=String(baseUrl).replace(/\/$/,"");
  if(typebotSessionId){
    return {mode:"continue",url:`${root}/api/v1/sessions/${encodeURIComponent(typebotSessionId)}/continueChat`,body:{message:envelope}};
  }
  return {mode:"start",url:`${root}/api/v1/typebots/${encodeURIComponent(publicId)}/startChat`,body:{message:envelope}};
}

export function typebotSessionMissing(response){
  const statusCode=typeof response==="number"?response:Number(response?.statusCode??0);
  if(statusCode===404||statusCode===410)return true;
  if(statusCode!==400)return false;
  const body=typeof response?.body==="string"?response.body:JSON.stringify(response?.body??{});
  return /session.{0,40}(not found|expired|invalid)|invalid.{0,40}session/i.test(body);
}

export function validateTypebotResponse(response,previousSessionId=null){
  const status=Number(response?.statusCode??200);
  if(status<200||status>=300)throw new Error(`TYPEBOT_HTTP_${status}`);
  const rawBody=response?.body??response;
  let body=rawBody;
  if(typeof rawBody==="string"){
    try{body=JSON.parse(rawBody);}catch{throw new Error("TYPEBOT_INVALID_RESPONSE");}
  }
  if(typeof body?.sessionId!=="string"||!body.sessionId||!Array.isArray(body.messages))
    throw new Error("TYPEBOT_INVALID_RESPONSE");
  return {response:body,typebotSessionId:body.sessionId,sessionChanged:body.sessionId!==previousSessionId};
}
