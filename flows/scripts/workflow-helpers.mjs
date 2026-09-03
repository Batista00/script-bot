// Deterministic export helpers; generated JSON contains credential NAMES only, never secrets.
export const config={backendBaseUrl:"https://admin.pablete.xyz/api",typebotBaseUrl:"https://bot.pablete.xyz",
  n8nBaseUrl:"https://n8n.pablete.xyz",
  typebotPublicId:"CONFIGURAR_PUBLIC_ID",
  evolutionBaseUrl:"https://evo.pablete.xyz",instance:"CONFIGURAR_INSTANCIA",automationIntegrationId:"CONFIGURAR_UUID",
  openaiModel:"CONFIGURAR_MODELO",evidenceAiEnabled:false};
export function workflow(name){return {name,nodes:[],connections:{},active:false,settings:{executionOrder:"v1",saveDataSuccessExecution:"none",saveDataErrorExecution:"none",saveManualExecutions:false,executionTimeout:240},pinData:{},tags:[]};}
export function node(w,name,type,parameters,extra={}){
  const version={httpRequest:4.2,code:2,webhook:2,respondToWebhook:1.4,scheduleTrigger:1.2,if:2.2,telegram:1.2,splitInBatches:3};
  w.nodes.push({id:name.toLowerCase().replace(/[^a-z0-9]/g,"-"),name,type:`n8n-nodes-base.${type}`,typeVersion:version[type],position:[w.nodes.length*240,0],parameters,...extra});return name;
}
export function link(w,from,to,output=0){const conn=w.connections[from]??={main:[]};while(conn.main.length<=output)conn.main.push([]);conn.main[output].push({node:to,type:"main",index:0});}
export const credential=(type,name)=>({credentials:{[type]:{name}}});
export function configNode(w){return node(w,"Config","code",{jsCode:`const config=${JSON.stringify(config)}; return $input.all().map((item,i)=>({json:{...item.json,config},pairedItem:{item:i}}));`});}
export function http(w,name,url,body,credentialName,extraParameters={}){
  return node(w,name,"httpRequest",{method:"POST",url,sendBody:true,specifyBody:"json",jsonBody:body,options:{timeout:60000,redirect:{redirect:{followRedirects:false}}},
    ...(credentialName ? {authentication:"genericCredentialType",genericAuthType:"httpHeaderAuth"}:{}),...extraParameters},
    credentialName?credential("httpHeaderAuth",credentialName):{});
}
export function branch(w,name,expression){return node(w,name,"if",{conditions:{options:{caseSensitive:true,leftValue:"",typeValidation:"strict",version:2},conditions:[{id:`${name}-condition`,leftValue:expression,rightValue:true,operator:{type:"boolean",operation:"true",singleValue:true}}],combinator:"and"},options:{}});}
export const cfg=(key)=>`$('Config').first().json.config.${key}`;
export const backend=(suffix)=>`={{ ${cfg("backendBaseUrl")} + '${suffix}' }}`;
export const runner=(suffix)=>`={{ ${cfg("backendBaseUrl")} + '/automation/v1/' + ${cfg("automationIntegrationId")} + '${suffix}' }}`;
export const scopedHeaders={sendHeaders:true,headerParameters:{parameters:[{name:"Authorization",value:"={{ 'Bearer ' + $('Open session').item.json.sessionToken }}"}]}};
