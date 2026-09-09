import type { Pool } from "pg";
import { withTransaction } from "../../core/database/database.js";
import { AppError } from "../../core/errors/app-error.js";
import type { DigitalAllocation, DigitalOrderItem, AssetReference } from "./digital-delivery.schema.js";

export class PostgresDigitalDeliveryRepository {
  constructor(private readonly db:Pool){}
  async list(businessId:string,productId:string){
    return (await this.db.query(`SELECT id,kind,label,status,reserved_order_id IS NOT NULL AS reserved,created_at AS "createdAt"
      FROM product_digital_assets WHERE business_id=$1 AND product_id=$2 ORDER BY created_at DESC LIMIT 100`,[businessId,productId])).rows;
  }
  async add(businessId:string,productId:string,kind:string,label:string,encrypted:string,fingerprint:string){
    try{return (await this.db.query(`INSERT INTO product_digital_assets(business_id,product_id,kind,label,value_encrypted,fingerprint)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id,kind,label,status`,[businessId,productId,kind,label,encrypted,fingerprint])).rows[0];}
    catch(error){if((error as {code?:string}).code==="23505")throw new AppError("Este contenido ya está registrado",409,"DIGITAL_ASSET_DUPLICATE");throw error;}
  }
  async status(businessId:string,productId:string,id:string,status:string){
    const result=await this.db.query(`UPDATE product_digital_assets SET status=$4 WHERE business_id=$1 AND product_id=$2 AND id=$3 AND reserved_order_id IS NULL RETURNING id`,[businessId,productId,id,status]);
    if(!result.rowCount)throw new AppError("El contenido no existe o está reservado para una compra",409,"DIGITAL_ASSET_NOT_EDITABLE");
  }
  async available(businessId:string,productId:string){
    return (await this.db.query<{downloads:number;licenses:number}>(`SELECT count(*) FILTER(WHERE kind='download')::integer AS downloads,
      count(*) FILTER(WHERE kind='license' AND reserved_order_id IS NULL)::integer AS licenses FROM product_digital_assets WHERE business_id=$1 AND product_id=$2 AND status='active'`,[businessId,productId])).rows[0]!;
  }
  async reserve(businessId:string,orderId:string,items:DigitalOrderItem[]):Promise<DigitalAllocation>{
    return withTransaction(this.db,async client=>{
      const order=(await client.query<{status:string}>("SELECT status FROM orders WHERE business_id=$1 AND id=$2 FOR UPDATE",[businessId,orderId])).rows[0];
      if(!order||!["pending_payment","paid","processing"].includes(order.status))throw new AppError("El pedido no admite reserva digital",409,"DIGITAL_ORDER_NOT_READY");
      const existing=(await client.query<DigitalAllocation>('SELECT id,order_id AS "orderId",assets FROM digital_order_deliveries WHERE business_id=$1 AND order_id=$2',[businessId,orderId])).rows[0];
      if(existing)return existing;
      const assets:AssetReference[]=[];
      for(const item of items){
        if(item.contents!=="licenses"){
          const downloads=(await client.query<{id:string}>("SELECT id FROM product_digital_assets WHERE business_id=$1 AND product_id=$2 AND kind='download' AND status='active' ORDER BY id FOR SHARE",[businessId,item.productId])).rows;
          if(!downloads.length)throw new AppError("Falta configurar el archivo o enlace de descarga",409,"DIGITAL_ASSETS_UNAVAILABLE");
          assets.push(...downloads.map(a=>({id:a.id,productName:item.productName})));
        }
        if(item.contents!=="downloads"){
          const codes=(await client.query<{id:string}>(`SELECT id FROM product_digital_assets WHERE business_id=$1 AND product_id=$2 AND kind='license' AND status='active'
            AND reserved_order_id IS NULL ORDER BY id LIMIT $3 FOR UPDATE SKIP LOCKED`,[businessId,item.productId,item.quantity])).rows;
          if(codes.length!==item.quantity)throw new AppError("No hay licencias suficientes para completar este pedido. Solicite ventas antes de pagar",409,"DIGITAL_ASSETS_UNAVAILABLE");
          await client.query("UPDATE product_digital_assets SET reserved_order_id=$3 WHERE business_id=$1 AND id=ANY($2::uuid[])",[businessId,codes.map(c=>c.id),orderId]);
          assets.push(...codes.map(a=>({id:a.id,productName:item.productName})));
        }
      }
      if(assets.length>100)throw new AppError("La entrega digital requiere preparación del equipo",409,"DIGITAL_DELIVERY_TOO_LARGE");
      return (await client.query<DigitalAllocation>(`INSERT INTO digital_order_deliveries(business_id,order_id,assets) VALUES($1,$2,$3)
        RETURNING id,order_id AS "orderId",assets`,[businessId,orderId,JSON.stringify(assets)])).rows[0]!;
    });
  }
  async allocation(businessId:string,orderId:string){
    return (await this.db.query<DigitalAllocation>('SELECT id,order_id AS "orderId",assets FROM digital_order_deliveries WHERE business_id=$1 AND order_id=$2',[businessId,orderId])).rows[0]??null;
  }
  async content(businessId:string,allocationId:string,validateReservation=false){
    const result=await this.db.query<{id:string;orderId:string;assets:AssetReference[]}>(`SELECT d.id,d.order_id AS "orderId",d.assets FROM digital_order_deliveries d JOIN orders o ON o.business_id=d.business_id AND o.id=d.order_id
      WHERE d.business_id=$1 AND d.id=$2 AND (o.status IN ('paid','processing','completed') OR ($3 AND o.status='pending_payment'))`,[businessId,allocationId,validateReservation]);
    const allocation=result.rows[0];if(!allocation)throw new AppError("La entrega necesita un pago verificado",409,"DIGITAL_PAYMENT_REQUIRED");
    const rows=(await this.db.query<{id:string;label:string;valueEncrypted:string}>(`SELECT id,label,value_encrypted AS "valueEncrypted" FROM product_digital_assets WHERE business_id=$1 AND id=ANY($2::uuid[])`,[businessId,allocation.assets.map(a=>a.id)])).rows;
    return {allocation,rows};
  }
  async reconcile(businessId:string){
    await this.db.query(`UPDATE orders o SET status='completed',updated_at=now() FROM digital_order_deliveries d JOIN automation_notifications n
      ON n.business_id=d.business_id AND n.event_key='digital:'||d.id::text AND n.channel='whatsapp' AND n.delivered_at IS NOT NULL AND n.last_error IS NULL
      WHERE o.business_id=$1 AND d.business_id=o.business_id AND d.order_id=o.id AND o.status IN ('paid','processing')`,[businessId]);
    // A cancelled, never-paid order cannot claim these licenses later.
    await this.db.query(`UPDATE product_digital_assets a SET reserved_order_id=NULL FROM orders o WHERE a.business_id=$1 AND o.business_id=a.business_id
      AND a.reserved_order_id=o.id AND o.status='cancelled' AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.business_id=o.business_id AND p.order_id=o.id AND p.status='approved')`,[businessId]);
  }
}
