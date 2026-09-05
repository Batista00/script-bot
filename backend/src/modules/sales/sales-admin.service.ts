import { AppError } from "../../core/errors/app-error.js";
import type { PostgresPaymentReviewsRepository } from "../payment-reviews/payment-reviews.repository.js";
import type { PostgresNotificationsRepository } from "../automation/notifications.repository.js";
import type { PostgresSalesRepository } from "./sales.repository.js";
import type { SalesSettings } from "./sales.types.js";
import type { PostgresSalesInboxRepository } from "./sales-inbox.repository.js";

export class SalesAdminService {
  constructor(private readonly sales:PostgresSalesRepository,private readonly reviews:PostgresPaymentReviewsRepository,
    private readonly notifications:PostgresNotificationsRepository,private readonly inbox:PostgresSalesInboxRepository) {}
  async overview(businessId:string) {
    return {settings:await this.sales.settings(businessId),reviewers:await this.reviews.listReviewers(businessId),
      sessions:await this.sales.adminSessions(businessId),checkouts:await this.sales.adminCheckouts(businessId),
      failures:await this.notifications.failures(businessId),
      inboxFailures:await this.inbox.failures(businessId),
      reviews:(await this.reviews.pending(businessId)).map(r=>({id:r.id,paymentId:r.paymentId,status:r.status,expiresAt:r.expiresAt}))};
  }
  async configure(businessId:string,settings:SalesSettings) {
    if (settings.enabled && (!settings.humanContact.trim() || !settings.telegramChatId)) {
      throw new AppError("Para activar ventas configura contacto humano y chat de Telegram",409,"SALES_CONFIGURATION_INCOMPLETE");
    }
    await this.sales.saveSettings(businessId,settings);
    return settings;
  }
  async bindReviewer(businessId:string,telegramId:string,userId:string) {
    await this.reviews.setReviewer(businessId,telegramId,userId); return {ok:true};
  }
  async unbindReviewer(businessId:string,telegramId:string) {
    await this.reviews.removeReviewer(businessId,telegramId); return {ok:true};
  }
  async pause(businessId:string,sessionId:string,paused:boolean) {
    return this.sales.exclusive(sessionId,async()=>{
      const session=await this.sales.session(businessId,sessionId);
      session.paused=paused; await this.sales.saveSession(session); return {ok:true};
    });
  }
  async resolveHumanHandoff(businessId:string,sessionId:string,userId:string,input:{
    outcome:"sale_completed"|"no_sale"|"follow_up"|"other";note:string;resumeBot:boolean;
  }) {
    return this.sales.exclusive(sessionId,async()=>{
      const session=await this.sales.session(businessId,sessionId);
      if (!session.paused) {
        throw new AppError("La conversación no está en atención humana",409,"SALES_SESSION_NOT_IN_HUMAN_HANDOFF");
      }
      const resolution={
        outcome:input.outcome,note:input.note,resolvedAt:new Date().toISOString(),resolvedBy:userId,
      };
      session.state.humanResolutions=[...(session.state.humanResolutions ?? []),resolution].slice(-20);
      session.paused=!input.resumeBot;
      await this.sales.saveSession(session);
      return {ok:true,paused:session.paused,resolution};
    });
  }
  async completeManual(businessId:string,checkoutId:string,userId:string,note:string) {
    await this.sales.completeManual(businessId,checkoutId,userId,note); return {ok:true};
  }
  async retryJob(businessId:string,kind:"inbox"|"notifications",id:string) {
    const requeued=await (kind==="inbox" ? this.inbox : this.notifications).retryFailed(businessId,id);
    if (!requeued) throw new AppError("Trabajo no encontrado o todavía en ejecución",409,"AUTOMATION_JOB_NOT_RETRYABLE");
    return {ok:true};
  }
}
