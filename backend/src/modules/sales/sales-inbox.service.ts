import { AppError } from "../../core/errors/app-error.js";
import { secretHash } from "./sales-access.service.js";
import type { PostgresSalesRepository } from "./sales.repository.js";
import type { PostgresSalesInboxRepository } from "./sales-inbox.repository.js";

export interface IncomingSalesMessage {contact:string;name?:string|undefined;messageId:string;text:string;image:boolean}
export interface InboxEntry {id:string;contact:string;payload:IncomingSalesMessage;lease:string;attempts:number}
export class SalesInboxService {
  constructor(private readonly repository:PostgresSalesInboxRepository,private readonly sales:PostgresSalesRepository) {}
  async resolve(businessId:string,id:string,lease:string) {
    const message=await this.repository.leasedMessage(businessId,id,lease);
    if (!message) throw new AppError("El turno expiró o no pertenece al negocio",401,"SALES_TURN_UNAUTHORIZED");
    return message;
  }
  async accept(businessId:string,input:IncomingSalesMessage) {
    if (!(await this.sales.settings(businessId)).enabled) throw new AppError("Ventas desactivadas",409,"SALES_DISABLED");
    const hash=secretHash(JSON.stringify(input));
    const result=await this.repository.accept(businessId,input,hash);
    if (result.requestHash!==hash) throw new AppError("Mensaje repetido con otro contenido",409,"SALES_MESSAGE_CONFLICT");
    return {accepted:true,id:result.id};
  }
  async claim(businessId:string) {
    return (await this.sales.settings(businessId)).enabled ? this.repository.claim(businessId) : [];
  }
  async finish(businessId:string,id:string,lease:string,text:string) {
    if (!await this.repository.finish(businessId,id,lease,text)) throw new AppError("Mensaje vencido o ya procesado",409,"INBOX_LEASE_EXPIRED");
    return {ok:true};
  }
}
