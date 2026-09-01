import type { Pool } from "pg";

export interface PaymentReview {
  id:string; businessId:string; paymentId:string; sessionId:string; evidenceHash:string;
  evidenceEncrypted:string|null; status:"pending"|"approving"|"approved"|"rejected"|"more_info";
  reviewerId:string|null; reference:string|null; callbackEncrypted:string; expiresAt:Date;
}
const columns=`id,business_id AS "businessId",payment_id AS "paymentId",session_id AS "sessionId",
  evidence_hash AS "evidenceHash",evidence_encrypted AS "evidenceEncrypted",status,reviewer_id AS "reviewerId",
  reference,callback_encrypted AS "callbackEncrypted",expires_at AS "expiresAt"`;
export class PostgresPaymentReviewsRepository {
  constructor(private readonly db:Pool) {}
  async create(businessId:string,paymentId:string,sessionId:string,hash:string,evidence:string,callbackHash:string,callback:string) {
    const result=await this.db.query<PaymentReview>(`INSERT INTO payment_reviews
      (business_id,payment_id,session_id,evidence_hash,evidence_encrypted,callback_hash,callback_encrypted)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(business_id,payment_id,evidence_hash) DO UPDATE SET evidence_hash=EXCLUDED.evidence_hash
      RETURNING ${columns}`,[businessId,paymentId,sessionId,hash,evidence,callbackHash,callback]);
    return result.rows[0]!;
  }
  async find(businessId:string,id:string):Promise<PaymentReview|null> {
    const result=await this.db.query<PaymentReview>(`SELECT ${columns} FROM payment_reviews WHERE business_id=$1 AND id=$2`,[businessId,id]);
    return result.rows[0] ?? null;
  }
  async byCallback(businessId:string,hash:string):Promise<PaymentReview|null> {
    const result=await this.db.query<PaymentReview>(`SELECT ${columns} FROM payment_reviews WHERE business_id=$1 AND callback_hash=$2`,[businessId,hash]);
    return result.rows[0] ?? null;
  }
  async authorizedReviewer(businessId:string,telegramId:string):Promise<string|null> {
    const result=await this.db.query<{user_id:string}>(`SELECT r.user_id FROM payment_reviewers r
      JOIN business_memberships m ON m.business_id=r.business_id AND m.user_id=r.user_id
      JOIN users u ON u.id=r.user_id
      WHERE r.business_id=$1 AND r.telegram_user_id=$2 AND m.role IN ('owner','admin') AND u.status='active'`,[businessId,telegramId]);
    return result.rows[0]?.user_id ?? null;
  }
  async setReviewer(businessId:string,telegramId:string,userId:string) {
    await this.db.query(`INSERT INTO payment_reviewers(business_id,telegram_user_id,user_id) VALUES($1,$2,$3)
      ON CONFLICT(business_id,telegram_user_id) DO UPDATE SET user_id=$3`,[businessId,telegramId,userId]);
  }
  async removeReviewer(businessId:string,telegramId:string) {
    await this.db.query("DELETE FROM payment_reviewers WHERE business_id=$1 AND telegram_user_id=$2",[businessId,telegramId]);
  }
  async listReviewers(businessId:string) {
    const result=await this.db.query(`SELECT telegram_user_id AS "telegramUserId",user_id AS "userId" FROM payment_reviewers WHERE business_id=$1`,[businessId]);
    return result.rows;
  }
  async decide(review:PaymentReview,status:PaymentReview["status"],userId:string,reference:string|null):Promise<void> {
    await this.db.query(`UPDATE payment_reviews SET status=$3,reviewer_id=$4,reference=$5,decided_at=now()
      WHERE business_id=$1 AND id=$2`,[review.businessId,review.id,status,userId,reference]);
  }
  async pending(businessId:string) {
    const result=await this.db.query<PaymentReview>(`SELECT ${columns} FROM payment_reviews WHERE business_id=$1
      AND status IN ('pending','approving','more_info') ORDER BY created_at LIMIT 50`,[businessId]);
    return result.rows;
  }
  async saveEvidence(businessId:string,id:string,encrypted:string):Promise<boolean> {
    const result=await this.db.query(`UPDATE payment_reviews SET evidence_encrypted=$3
      WHERE business_id=$1 AND id=$2 AND evidence_encrypted IS NOT NULL AND expires_at>now()`,[businessId,id,encrypted]);
    return result.rowCount===1;
  }
}
