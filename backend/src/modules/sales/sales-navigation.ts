import type { PostgresSalesRepository } from "./sales.repository.js";
import type { SalesReply,SalesSession } from "./sales.types.js";
import { normalizeText,catalogTermGroupsFromText } from "./sales-catalog.js";

/** Category labels and IDs always come from the current business, never from the prompt. */
export class SalesNavigation {
  constructor(private readonly repository:PostgresSalesRepository) {}
  async show(session:SalesSession,parentId:string|null=null):Promise<SalesReply|null> {
    const categories=await this.repository.commercialCategories(session.businessId);
    const options=categories.filter(c=>c.parentId===parentId);
    if(!options.length)return null;
    session.state.categoryChoices=options;
    session.state.choices=[];session.state.choiceQuantities=[];session.state.choiceLabels=[];
    session.state.phase="browse";session.state.offset=0;
    session.state.termGroups=parentId?catalogTermGroupsFromText(categories.find(c=>c.id===parentId)?.name??""):[];
    if(parentId)session.state.categoryId=parentId;else delete session.state.categoryId;
    const text=(parentId?"En esta categoría puede elegir:":"Contamos con estas categorías:")+"\n"+
      options.map(c=>"✅ "+c.name).join("\n")+"\n¿Cuál le interesa? También puede indicarme directamente el servicio que busca.";
    return {text,catalogText:text};
  }
  async select(session:SalesSession,text:string):Promise<"selected"|SalesReply|null> {
    const words=normalizeText(text).replace(/^(?:de|quiero|busco|necesito)\s+/,"").trim();
    const options=session.state.categoryChoices??[];
    const index=/^[1-9][0-9]*$/.test(words)?Number(words)-1:-1;
    const all=await this.repository.commercialCategories(session.businessId);
    const matches=options.filter(c=>normalizeText(c.name).endsWith(" "+words));
    const selected=(index>=0 ? options[index] : undefined) ??
      all.find(c=>normalizeText(c.name)===words) ??
      (matches.length===1?matches[0]:undefined);
    if(!selected)return null;
    const children=await this.show(session,selected.id);
    if(children)return children;
    session.state.categoryId=selected.id;session.state.termGroups=catalogTermGroupsFromText(selected.name);session.state.offset=0;
    session.state.categoryChoices=[];session.state.choices=[];session.state.choiceLabels=[];
    return "selected";
  }
}
