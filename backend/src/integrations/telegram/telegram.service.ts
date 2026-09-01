import { timingSafeEqual } from "node:crypto";
import { AppError } from "../../core/errors/app-error.js";
import type { IntegrationsService } from "../../modules/integrations/integrations.service.js";
import type { PaymentReviewsService } from "../../modules/payment-reviews/payment-reviews.service.js";
import type { PostgresSalesRepository } from "../../modules/sales/sales.repository.js";
import { secretHash } from "../../modules/sales/sales-access.service.js";

export function verifySharedSecret(actual:unknown,expected:unknown):boolean {
  return typeof actual==="string" && typeof expected==="string" && expected.length>=32 && actual.length<=256 &&
    timingSafeEqual(Buffer.from(secretHash(actual)),Buffer.from(secretHash(expected)));
}
export interface TelegramUpdate {
  callback_query?:{id:string;from:{id:number};data?:string|undefined;message?:{chat:{id:number}}|undefined}|undefined;
  message?:{from?:{id:number}|undefined;chat:{id:number};text?:string|undefined}|undefined;
}
export class TelegramService {
  constructor(private readonly integrations:IntegrationsService,private readonly reviews:PaymentReviewsService,
    private readonly sales:PostgresSalesRepository,private readonly http:typeof fetch=fetch) {}
  async receive(integrationId:string,secret:unknown,update:TelegramUpdate) {
    const integration=await this.integrations.getActiveIntegrationById(integrationId,"telegram");
    if (!integration || !verifySharedSecret(secret,integration.credentials.webhookSecret)) {
      throw new AppError("Webhook no autorizado",401,"TELEGRAM_WEBHOOK_UNAUTHORIZED");
    }
    const settings=await this.sales.settings(integration.businessId);
    if (!settings.enabled) return {ok:true};
    const callback=update.callback_query;
    const chatId=callback?.message?.chat.id ?? update.message?.chat.id;
    const userId=callback?.from.id ?? update.message?.from?.id;
    if (String(chatId)!==settings.telegramChatId || !userId) return {ok:true};
    let text:string;
    try {
      if (callback) {
        const match=/^(approve|reject|info):([A-Za-z0-9_-]{32})$/.exec(callback.data ?? "");
        if (!match) return {ok:true};
        text=(await this.reviews.decide(integration.businessId,String(userId),match[2]!,match[1] as "approve"|"reject"|"info")).text;
      } else {
        const match=/^\/abono(?:@[A-Za-z0-9_]+)? ([A-Za-z0-9_-]{32}) (.{1,128})$/.exec(update.message?.text ?? "");
        if (!match) return {ok:true};
        text=(await this.reviews.decide(integration.businessId,String(userId),match[1]!,"approve",match[2])).text;
      }
    } catch(error) {
      if (!(error instanceof AppError) || error.statusCode>=500) throw error;
      text=error.message;
    }
    const botToken=integration.credentials.botToken;
    if (typeof botToken!=="string" || !/^[0-9]+:[A-Za-z0-9_-]+$/.test(botToken)) {
      throw new AppError("Telegram no está configurado",503,"TELEGRAM_NOT_CONFIGURED");
    }
    if (callback) await this.send(botToken,"answerCallbackQuery",{callback_query_id:callback.id,text:"Revisión procesada"});
    await this.send(botToken,"sendMessage",{chat_id:String(chatId),text});
    return {ok:true};
  }
  private async send(token:string,method:string,body:Record<string,string>) {
    try {
      const response=await this.http(`https://api.telegram.org/bot${token}/${method}`,{
        method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(10_000),redirect:"error",
      });
      if (!response.ok || (await response.json() as {ok?:boolean}).ok!==true) throw new Error();
    } catch { throw new AppError("Telegram no está disponible temporalmente",503,"TELEGRAM_UNAVAILABLE"); }
  }
}
