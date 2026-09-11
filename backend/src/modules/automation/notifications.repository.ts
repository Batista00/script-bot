import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { JsonObject } from "../integrations/integrations.types.js";

export interface Notification {
  id: string; businessId: string; channel: "whatsapp" | "telegram";
  payload: JsonObject; lease: string; attempts: number;
}
export class PostgresNotificationsRepository {
  constructor(private readonly db: Pool) {}
  async enqueue(businessId: string, key: string, channel: Notification["channel"], payload: JsonObject): Promise<void> {
    await this.db.query(`INSERT INTO automation_notifications(business_id,event_key,channel,payload) VALUES($1,$2,$3,$4)
      ON CONFLICT(business_id,event_key) DO NOTHING`,[businessId,key,channel,JSON.stringify(payload)]);
  }
  async claim(businessId: string): Promise<Notification[]> {
    const result = await this.db.query<Notification>(`WITH candidate AS (
      SELECT n.id FROM automation_notifications n WHERE n.business_id=$1 AND n.delivered_at IS NULL
        AND n.attempts<8 AND n.available_at<=now() AND (n.lease_until IS NULL OR n.lease_until<now())
        AND NOT EXISTS(SELECT 1 FROM automation_notifications older
          WHERE older.business_id=n.business_id AND older.channel=n.channel AND older.delivered_at IS NULL
          AND older.attempts<8 AND COALESCE(older.payload->>'contact',older.payload->>'chatId')=COALESCE(n.payload->>'contact',n.payload->>'chatId')
          AND (older.created_at,older.id)<(n.created_at,n.id))
      ORDER BY n.created_at,n.id FOR UPDATE SKIP LOCKED LIMIT 3
    ) UPDATE automation_notifications n SET lease=$2,lease_until=now()+interval '5 minutes',attempts=n.attempts+1
      FROM candidate c WHERE n.id=c.id RETURNING n.id,n.business_id AS "businessId",n.channel,n.payload,n.lease,n.attempts`,
    [businessId,randomUUID()]);
    return result.rows;
  }
  async finish(businessId: string, id: string, lease: string, success: boolean): Promise<boolean> {
    const result = await this.db.query(`UPDATE automation_notifications SET
      delivered_at=CASE WHEN $4 THEN now() ELSE NULL END,
      available_at=now()+make_interval(secs=>LEAST(3600,30*power(2,attempts)::int)),
      last_error=CASE WHEN $4 THEN NULL ELSE 'DELIVERY_FAILED' END,lease=NULL,lease_until=NULL
      WHERE business_id=$1 AND id=$2 AND lease=$3 AND lease_until>now() AND delivered_at IS NULL`,[businessId,id,lease,success]);
    return result.rowCount === 1;
  }
  async failures(businessId: string) {
    const result = await this.db.query(`SELECT id,channel,attempts,last_error AS "lastError",created_at AS "createdAt"
      FROM automation_notifications WHERE business_id=$1 AND delivered_at IS NULL AND attempts>=8 ORDER BY created_at LIMIT 50`,[businessId]);
    return result.rows;
  }
  async suppressContact(businessId:string,contact:string):Promise<void> {
    await this.db.query(`UPDATE automation_notifications SET delivered_at=now(),last_error='CONTACT_OPTED_OUT',lease=NULL,lease_until=NULL
      WHERE business_id=$1 AND channel='whatsapp' AND payload->>'contact'=$2 AND delivered_at IS NULL`,[businessId,contact]);
  }
  async retryFailed(businessId:string,id:string):Promise<boolean> {
    const result=await this.db.query(`UPDATE automation_notifications SET attempts=0,available_at=now(),lease=NULL,lease_until=NULL,
      last_error='MANUALLY_REQUEUED' WHERE business_id=$1 AND id=$2 AND delivered_at IS NULL AND attempts>=8
      AND (lease_until IS NULL OR lease_until<now())`,[businessId,id]);
    return result.rowCount===1;
  }
}
