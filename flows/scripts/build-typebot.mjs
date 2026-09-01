export function typebot(){
  const variables=["session_token","message_id","customer_message","request_body","bot_reply"].map(name=>({id:`v${name.replaceAll('_','')}`,name,isSessionVariable:true}));
  const variableId=name=>variables.find(v=>v.name===name).id;
  // Stateless presentation per incoming WhatsApp message. Commercial state lives in PostgreSQL.
  return {version:"6.1",id:"bwtypesales61",name:"BW — Asistente de ventas 6.1",events:[{id:"start",type:"start",graphCoordinates:{x:0,y:0},outgoingEdgeId:"startedge"}],
    groups:[
      {id:"prepare",title:"Preparar solicitud segura",graphCoordinates:{x:250,y:0},blocks:[
        {id:"clearreply",type:"Set variable",options:{variableId:variableId("bot_reply"),expressionToEvaluate:"No pudimos procesar el mensaje. Escribe HUMANO si el problema continúa."}},
        {id:"buildbody",type:"Set variable",options:{variableId:variableId("request_body"),isCode:true,expressionToEvaluate:"JSON.stringify({messageId: {{message_id}}, text: {{customer_message}}})"},outgoingEdgeId:"preparedge"}]},
      {id:"request",title:"Consultar backend a través de n8n",graphCoordinates:{x:600,y:0},blocks:[
        {id:"callbridge",type:"Webhook",options:{isCustomBody:true,webhook:{url:"https://n8n.pablete.xyz/webhook/bw-sales-bridge",method:"POST",headers:[
          {id:"authheader",key:"Authorization",value:"Bearer {{session_token}}"},{id:"jsonheader",key:"Content-Type",value:"application/json"}],body:"{{request_body}}"},
          responseVariableMapping:[{id:"mapreply",bodyPath:"data.text",variableId:variableId("bot_reply")}]},outgoingEdgeId:"replyedge"}]},
      {id:"reply",title:"Respuesta al cliente",graphCoordinates:{x:950,y:0},blocks:[{id:"replytext",type:"text",content:{richText:[{type:"p",children:[{text:"{{bot_reply}}"}]}]}}]},
    ],edges:[{id:"startedge",from:{eventId:"start"},to:{groupId:"prepare"}},{id:"preparedge",from:{blockId:"buildbody"},to:{groupId:"request"}},{id:"replyedge",from:{blockId:"callbridge"},to:{groupId:"reply"}}],
    variables,theme:{},settings:{},selectedThemeTemplateId:null,publicId:null,isArchived:false,isClosed:false};
}
