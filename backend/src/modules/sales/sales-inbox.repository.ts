import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { withTransaction } from "../../core/database/database.js";
import type { IncomingSalesMessage,InboxEntry } from "./sales-inbox.service.js";

export class PostgresSalesInboxRepository {
  constructor(private readonly db:Pool) {}
  async leasedMessage(businessId:string,id:string,lease:string):Promise<IncomingSalesMessage|null> {
    const result=await this.db.query<{payload:IncomingSalesMessage}>(`SELECT payload FROM sales_inbox WHERE business_id=$1 AND id=$2 AND lease=$3 AND lease_until>now() AND completed_at IS NULL`,[businessId,id,lease]);
    return result.rows[0]?.payload ?? null;
  }
  async accept(businessId:string,input:IncomingSalesMessage,hash:string) {
    const result=await this.db.query<{id:string;requestHash:string}>(`INSERT INTO sales_inbox(business_id,message_id,contact,payload,request_hash)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(business_id,contact,message_id) DO UPDATE SET message_id=EXCLUDED.message_id
      RETURNING id,request_hash AS "requestHash"`,[businessId,input.messageId,input.contact,JSON.stringify(input),hash]);
    return result.rows[0]!;
  }
  async claim(businessId:string):Promise<InboxEntry[]> {
    // Process only the oldest uncompleted message per contact, including leased/failed heads.
    const result=await this.db.query<InboxEntry>(`WITH candidate AS (
      SELECT i.id FROM sales_inbox i WHERE business_id=$1 AND completed_at IS NULL AND attempts<8
        AND available_at<=now() AND (lease_until IS NULL OR lease_until<now())
        AND NOT EXISTS(SELECT 1 FROM sales_inbox older WHERE older.business_id=i.business_id AND older.contact=i.contact
          AND older.completed_at IS NULL AND older.attempts<8 AND (older.created_at,older.id)<(i.created_at,i.id))
      ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE sales_inbox i SET lease=$2,lease_until=now()+interval '5 minutes',attempts=i.attempts+1,
      available_at=now()+interval '5 minutes' FROM candidate c WHERE c.id=i.id
      RETURNING i.id,i.contact,i.payload,i.lease,i.attempts`,[businessId,randomUUID()]);
    return result.rows;
  }
  async finish(businessId:string,id:string,lease:string,text:string):Promise<boolean> {
    return withTransaction(this.db,async(client)=>{
      const entry=await client.query<{contact:string}>(`UPDATE sales_inbox SET completed_at=now(),lease=NULL,lease_until=NULL
        WHERE business_id=$1 AND id=$2 AND lease=$3 AND lease_until>now() AND completed_at IS NULL RETURNING contact`,[businessId,id,lease]);
      if (!entry.rows[0]) return false;
      if (text.trim()) await client.query(`INSERT INTO automation_notifications(business_id,event_key,channel,payload)
        VALUES($1,$2,'whatsapp',$3) ON CONFLICT(business_id,event_key) DO NOTHING`,[businessId,`reply:${id}`,JSON.stringify({contact:entry.rows[0].contact,text})]);
      return true;
    });
  }
  async failures(businessId:string) {
    const result=await this.db.query(`SELECT id,contact,attempts FROM sales_inbox WHERE business_id=$1
      AND completed_at IS NULL AND attempts>=8 ORDER BY created_at LIMIT 50`,[businessId]);
    return result.rows;
  }
  async retryFailed(businessId:string,id:string):Promise<boolean> {
    const result=await this.db.query(`UPDATE sales_inbox SET attempts=0,available_at=now(),lease=NULL,lease_until=NULL
      WHERE business_id=$1 AND id=$2 AND completed_at IS NULL AND attempts>=8 AND (lease_until IS NULL OR lease_until<now())`,[businessId,id]);
    return result.rowCount===1;
  }
}
