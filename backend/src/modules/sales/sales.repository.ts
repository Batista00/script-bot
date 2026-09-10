import type { Pool,PoolClient } from "pg";
import { withTransaction } from "../../core/database/database.js";
import { AppError } from "../../core/errors/app-error.js";
import type { SalesCheckout, SalesReply, SalesSession, SalesSettings, DeliverySnapshot } from "./sales.types.js";
import { defaultSalesSettings } from "./sales.types.js";

const sessionColumns = `id, business_id AS "businessId", customer_id AS "customerId", contact, state, paused,
  typebot_session_id AS "typebotSessionId"`;
const checkoutColumns = `id, business_id AS "businessId", session_id AS "sessionId", quote_id AS "quoteId",
  order_id AS "orderId", payment_id AS "paymentId", delivery, last_order_status AS "lastOrderStatus",
  attention_code AS "attentionCode"`;
// Conversation inactivity is independent of financial reconciliation and token expiry.
const inactiveSession = `s.updated_at<=now()-interval '1 hour' AND NOT s.paused
  AND (s.typebot_session_id IS NOT NULL OR s.state->>'greeted'='true' OR coalesce(s.state->>'phase','browse')<>'browse')
  AND NOT EXISTS(SELECT 1 FROM payment_reviews r WHERE r.business_id=s.business_id AND r.session_id=s.id
    AND r.status IN ('pending','approving','more_info'))
  AND NOT EXISTS(SELECT 1 FROM sales_checkouts c JOIN orders o ON o.business_id=c.business_id AND o.id=c.order_id
    WHERE c.business_id=s.business_id AND c.session_id=s.id AND o.status IN ('paid','processing'))
  AND NOT EXISTS(SELECT 1 FROM sales_inbox i WHERE i.business_id=s.business_id AND i.contact=s.contact
    AND i.completed_at IS NULL AND i.attempts<8)`;

export class PostgresSalesRepository {
  private activeLocks=0;
  constructor(private readonly db: Pool) {}
  async commercialCategories(businessId:string) {
    const result=await this.db.query<{id:string;name:string;parentId:string|null}>(`SELECT c.id,c.name,c.parent_id AS "parentId"
      FROM categories c WHERE c.business_id=$1 AND c.status='active'
      AND (c.parent_id IS NULL OR EXISTS(SELECT 1 FROM categories parent
        WHERE parent.business_id=c.business_id AND parent.id=c.parent_id AND parent.status='active'))
      AND EXISTS(SELECT 1 FROM products p JOIN categories leaf ON leaf.business_id=p.business_id AND leaf.id=p.category_id
        WHERE p.business_id=c.business_id AND p.status='active' AND leaf.status='active'
        AND (leaf.id=c.id OR leaf.parent_id=c.id)
        AND EXISTS(SELECT 1 FROM product_prices price WHERE price.business_id=p.business_id AND price.product_id=p.id AND price.status='active'))
      ORDER BY c.name,c.id`,[businessId]);
    return result.rows;
  }

  /** Session-level lock, NOT a transaction: external calls never run in a DB transaction. */
  async exclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    // Reserve pool capacity for repositories called while a session lock is held.
    // Reject overload rather than deadlock every connection waiting on this same pool.
    if (this.activeLocks>=Math.max(1,Math.floor((this.db.options.max ?? 10)/2))) {
      throw new AppError("Hay una operación en curso; vuelve a intentar",409,"SALES_BUSY");
    }
    this.activeLocks++;
    let client:PoolClient|undefined;
    let locked = false;
    try {
      client=await this.db.connect();
      const result = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [`sales:${key}`]);
      locked = result.rows[0]?.locked === true;
      if (!locked) throw new AppError("Hay una operación en curso; vuelve a intentar", 409, "SALES_BUSY");
      return await operation();
    } finally {
      let discard=false;
      try { if (locked) await client?.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [`sales:${key}`]); }
      catch(error) { discard=true;throw error; }
      finally { client?.release(discard);this.activeLocks--; }
    }
  }
  async settings(businessId: string): Promise<SalesSettings> {
    const result = await this.db.query<{ config: SalesSettings }>("SELECT config FROM sales_settings WHERE business_id=$1", [businessId]);
    return { ...defaultSalesSettings, ...result.rows[0]?.config };
  }
  async saveSettings(businessId: string, config: SalesSettings): Promise<void> {
    await this.db.query(`INSERT INTO sales_settings(business_id,config) VALUES($1,$2)
      ON CONFLICT(business_id) DO UPDATE SET config=$2, updated_at=now()`, [businessId, JSON.stringify(config)]);
  }
  async ensureSession(businessId: string, customerId: string, contact: string): Promise<SalesSession> {
    const result = await this.db.query<SalesSession>(`INSERT INTO sales_sessions(business_id,customer_id,contact)
      VALUES($1,$2,$3) ON CONFLICT(business_id,contact) DO UPDATE SET updated_at=now() RETURNING ${sessionColumns}`,
    [businessId, customerId, contact]);
    return result.rows[0]!;
  }
  async session(businessId: string, id: string): Promise<SalesSession> {
    const result = await this.db.query<SalesSession>(`SELECT ${sessionColumns} FROM sales_sessions WHERE business_id=$1 AND id=$2`, [businessId, id]);
    if (!result.rows[0]) throw new AppError("Conversación no encontrada", 404, "SALES_SESSION_NOT_FOUND");
    return result.rows[0];
  }
  async saveSession(session: SalesSession): Promise<void> {
    await this.db.query(`UPDATE sales_sessions SET state=$3,paused=$4,updated_at=now() WHERE business_id=$1 AND id=$2`,
      [session.businessId, session.id, JSON.stringify(session.state), session.paused]);
  }
  async setTypebotSession(businessId: string, sessionId: string, typebotSessionId: string | null): Promise<void> {
    const result = await this.db.query(
      "UPDATE sales_sessions SET typebot_session_id=$3,updated_at=now() WHERE business_id=$1 AND id=$2",
      [businessId, sessionId, typebotSessionId],
    );
    if (!result.rowCount) throw new AppError("Conversación no encontrada", 404, "SALES_SESSION_NOT_FOUND");
  }
  async addToken(session: SalesSession, hash: string): Promise<void> {
    await this.db.query("INSERT INTO sales_session_tokens(token_hash,business_id,session_id) VALUES($1,$2,$3)", [hash, session.businessId, session.id]);
  }
  async token(hash: string): Promise<{ businessId: string; sessionId: string } | null> {
    const result = await this.db.query<{ businessId: string; sessionId: string }>(`SELECT business_id AS "businessId",session_id AS "sessionId"
      FROM sales_session_tokens WHERE token_hash=$1 AND expires_at>now()`, [hash]);
    return result.rows[0] ?? null;
  }
  async message(session: SalesSession, id: string): Promise<{ requestHash: string; response: SalesReply | null } | null> {
    const result = await this.db.query<{ requestHash: string; response: SalesReply | null }>(`SELECT request_hash AS "requestHash",response
      FROM sales_messages WHERE business_id=$1 AND session_id=$2 AND message_id=$3`, [session.businessId,session.id,id]);
    return result.rows[0] ?? null;
  }
  async beginMessage(session: SalesSession, id: string, hash: string): Promise<void> {
    await this.db.query(`INSERT INTO sales_messages(business_id,session_id,message_id,request_hash) VALUES($1,$2,$3,$4)
      ON CONFLICT(session_id,message_id) DO NOTHING`, [session.businessId,session.id,id,hash]);
  }
  async finishMessage(session: SalesSession, id: string, response: SalesReply): Promise<void> {
    await withTransaction(this.db,async(client)=>{
      await client.query("UPDATE sales_sessions SET state=$3,paused=$4,updated_at=now() WHERE business_id=$1 AND id=$2",
        [session.businessId,session.id,JSON.stringify(session.state),session.paused]);
      await client.query("UPDATE sales_messages SET response=$4 WHERE business_id=$1 AND session_id=$2 AND message_id=$3",
        [session.businessId,session.id,id,JSON.stringify(response)]);
    });
  }
  async createCheckout(session: SalesSession, quoteId: string, delivery: DeliverySnapshot): Promise<SalesCheckout> {
    const result = await this.db.query<SalesCheckout>(`INSERT INTO sales_checkouts(business_id,session_id,quote_id,delivery)
      VALUES($1,$2,$3,$4) RETURNING ${checkoutColumns}`, [session.businessId,session.id,quoteId,JSON.stringify(delivery)]);
    return result.rows[0]!;
  }
  async checkout(businessId: string, id: string): Promise<SalesCheckout> {
    const result = await this.db.query<SalesCheckout>(`SELECT ${checkoutColumns} FROM sales_checkouts WHERE business_id=$1 AND id=$2`, [businessId,id]);
    if (!result.rows[0]) throw new AppError("Compra no encontrada",404,"SALES_CHECKOUT_NOT_FOUND");
    return result.rows[0];
  }
  async orderForQuote(businessId: string, quoteId: string): Promise<string | null> {
    const result = await this.db.query<{ id: string }>("SELECT id FROM orders WHERE business_id=$1 AND quote_id=$2",[businessId,quoteId]);
    return result.rows[0]?.id ?? null;
  }
  async linkOrder(checkout: SalesCheckout, orderId: string): Promise<void> {
    await this.db.query("UPDATE sales_checkouts SET order_id=$3 WHERE business_id=$1 AND id=$2",[checkout.businessId,checkout.id,orderId]);
  }
  async linkPayment(checkout: SalesCheckout, paymentId: string): Promise<void> {
    await this.db.query("UPDATE sales_checkouts SET payment_id=$3 WHERE business_id=$1 AND id=$2",[checkout.businessId,checkout.id,paymentId]);
  }
  async due(businessId: string): Promise<SalesCheckout[]> {
    const result = await this.db.query<SalesCheckout>(`SELECT ${checkoutColumns} FROM sales_checkouts
      WHERE business_id=$1 AND order_id IS NOT NULL AND NOT closed AND next_check_at<=now() ORDER BY next_check_at,id LIMIT 5`,[businessId]);
    return result.rows;
  }
  async checkpoint(checkout: SalesCheckout, status: string, attention: string | null, closed: boolean): Promise<void> {
    await this.db.query(`UPDATE sales_checkouts SET last_order_status=$3,attention_code=$4,closed=$5,
      next_check_at=now()+interval '1 minute' WHERE business_id=$1 AND id=$2`,[checkout.businessId,checkout.id,status,attention,closed]);
  }
  async catalog(businessId: string, search: string, offset: number, limit=6,categoryId:string|null=null): Promise<string[]> {
    const result = await this.db.query<{ id: string }>(`SELECT p.id FROM products p WHERE p.business_id=$1 AND p.status='active'
      AND (strpos(lower(p.name),lower($2))>0 OR strpos(lower(coalesce(p.sku,'')),lower($2))>0)
      AND ($5::uuid IS NULL OR p.category_id=$5 OR EXISTS(SELECT 1 FROM categories c WHERE c.business_id=p.business_id AND c.id=p.category_id AND c.parent_id=$5))
      AND EXISTS(SELECT 1 FROM product_prices pr WHERE pr.business_id=p.business_id AND pr.product_id=p.id AND pr.status='active')
      ORDER BY p.name,p.id LIMIT $4 OFFSET $3`,[businessId,search,offset,limit,categoryId]);
    return result.rows.map((row)=>row.id);
  }
  async catalogByTermGroups(businessId: string, termGroups: string[][], offset: number, limit=6,categoryId:string|null=null): Promise<string[]> {
    const result = await this.db.query<{ id: string }>(`SELECT p.id FROM products p
      LEFT JOIN categories c ON c.business_id=p.business_id AND c.id=p.category_id
      WHERE p.business_id=$1 AND p.status='active'
      AND ($5::uuid IS NULL OR c.id=$5 OR c.parent_id=$5)
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements($2::jsonb) AS search_group(value)
        WHERE NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(search_group.value) AS candidate(term)
          WHERE strpos(lower(concat_ws(' ',p.name,p.description,p.sku,c.name)),lower(candidate.term))>0
        )
      )
      AND EXISTS(SELECT 1 FROM product_prices pr WHERE pr.business_id=p.business_id AND pr.product_id=p.id AND pr.status='active')
      ORDER BY p.name,p.id LIMIT $4 OFFSET $3`,[businessId,JSON.stringify(termGroups),offset,limit,categoryId]);
    return result.rows.map((row)=>row.id);
  }
  async cleanExpired(businessId: string, days: number): Promise<void> {
    await this.db.query("DELETE FROM sales_session_tokens WHERE business_id=$1 AND expires_at<now()",[businessId]);
    await this.db.query(`UPDATE payment_reviews SET evidence_encrypted=NULL WHERE business_id=$1
      AND created_at<now()-make_interval(days=>$2) AND evidence_encrypted IS NOT NULL`,[businessId,days]);
  }
  async adminSessions(businessId:string) {
    const result=await this.db.query(`SELECT id,contact,paused,state->>'phase' AS phase,
      state->'humanResolutions' AS resolutions,state->'deliverySelection' AS "deliverySelection",updated_at AS "updatedAt" FROM sales_sessions
      WHERE business_id=$1 ORDER BY updated_at DESC LIMIT 50`,[businessId]);
    return result.rows;
  }
  async inactiveSessions(businessId:string):Promise<string[]> {
    const result=await this.db.query<{id:string}>(`SELECT s.id FROM sales_sessions s
      WHERE s.business_id=$1 AND ${inactiveSession} ORDER BY s.updated_at,s.id LIMIT 50`,[businessId]);
    return result.rows.map(row=>row.id);
  }
  /** Called under the same session lock as conversation processing. Keep order/evidence history. */
  async closeInactiveSession(businessId:string,sessionId:string):Promise<boolean> {
    const result=await this.db.query(`UPDATE sales_sessions s SET
      state=(s.state-ARRAY['product','quantity','input','choices','choiceQuantities','choiceLabels','paymentChoices','search','termGroups','offset','categoryId','categoryChoices','deliverySelection','cart'])
        || jsonb_build_object('phase','browse','greeted',false),
      typebot_session_id=NULL,updated_at=now()
      WHERE s.business_id=$1 AND s.id=$2 AND ${inactiveSession}`,[businessId,sessionId]);
    return result.rowCount===1;
  }
  async adminCheckouts(businessId:string) {
    const result=await this.db.query(`SELECT id,order_id AS "orderId",delivery->>'mode' AS mode,attention_code AS "attentionCode",
      last_order_status AS status FROM sales_checkouts WHERE business_id=$1 AND order_id IS NOT NULL ORDER BY created_at DESC LIMIT 50`,[businessId]);
    return result.rows;
  }
  async completeManual(businessId:string,checkoutId:string,userId:string,note:string) {
    return withTransaction(this.db,async(client)=>{
      const record=await client.query<{order_id:string}>(`SELECT order_id FROM sales_checkouts WHERE business_id=$1 AND id=$2
        AND delivery->>'mode'='manual' FOR UPDATE`,[businessId,checkoutId]);
      if (!record.rows[0]) throw new AppError("Entrega manual no encontrada",404,"MANUAL_DELIVERY_NOT_FOUND");
      const existing=await client.query("SELECT 1 FROM sales_manual_deliveries WHERE business_id=$1 AND checkout_id=$2",[businessId,checkoutId]);
      if (existing.rowCount) return;
      const updated=await client.query("UPDATE orders SET status='completed',updated_at=now() WHERE business_id=$1 AND id=$2 AND status='paid'",[businessId,record.rows[0].order_id]);
      if (!updated.rowCount) throw new AppError("Solo se pueden entregar pedidos pagados",409,"ORDER_NOT_READY_FOR_FULFILLMENT");
      await client.query("INSERT INTO sales_manual_deliveries(business_id,checkout_id,user_id,note) VALUES($1,$2,$3,$4)",[businessId,checkoutId,userId,note]);
      await client.query("UPDATE sales_checkouts SET next_check_at=now() WHERE business_id=$1 AND id=$2",[businessId,checkoutId]);
    });
  }
}
