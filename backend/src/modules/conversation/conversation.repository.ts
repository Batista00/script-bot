import type { DatabaseExecutor } from "../../core/database/database.js";
import type {
  CategoryNode,
  ConversationPayload,
  ConversationSession,
  ConversationState,
  ConversationTurnResponse,
  OrderSummary,
  ProductNode,
} from "./conversation.types.js";

interface SessionRow {
  id: string;
  business_id: string;
  remote_jid: string;
  customer_id: string | null;
  state: string;
  payload: ConversationPayload;
  page: number;
  handoff: boolean;
}

interface CategoryRow {
  id: string;
  name: string;
  parent_id: string | null;
}

interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  min_quantity: number | null;
  max_quantity: number | null;
  required_inputs: ProductNode["requiredInputs"];
}

interface OrderRow {
  id: string;
  status: string;
  total: number;
  currency: string;
  created_at: Date | string;
}

function toSession(row: SessionRow): ConversationSession {
  return {
    id: row.id,
    businessId: row.business_id,
    remoteJid: row.remote_jid,
    customerId: row.customer_id,
    state: row.state as ConversationState,
    payload: row.payload ?? {},
    page: row.page,
    handoff: row.handoff,
  };
}

export class PostgresConversationRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async findSession(businessId: string, remoteJid: string): Promise<ConversationSession | null> {
    const result = await this.db.query<SessionRow>(
      `SELECT id, business_id, remote_jid, customer_id, state, payload, page, handoff
         FROM conversation_sessions
        WHERE business_id = $1 AND remote_jid = $2`,
      [businessId, remoteJid],
    );
    return result.rows[0] ? toSession(result.rows[0]) : null;
  }

  /** Crea o actualiza el estado. La conversación es por negocio + número. */
  async saveSession(session: {
    businessId: string;
    remoteJid: string;
    customerId: string | null;
    state: ConversationState;
    payload: ConversationPayload;
    page: number;
    handoff: boolean;
  }): Promise<ConversationSession> {
    const result = await this.db.query<SessionRow>(
      `INSERT INTO conversation_sessions
         (business_id, remote_jid, customer_id, state, payload, page, handoff, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, now())
       ON CONFLICT (business_id, remote_jid) DO UPDATE SET
         customer_id = EXCLUDED.customer_id,
         state = EXCLUDED.state,
         payload = EXCLUDED.payload,
         page = EXCLUDED.page,
         handoff = EXCLUDED.handoff,
         updated_at = now()
       RETURNING id, business_id, remote_jid, customer_id, state, payload, page, handoff`,
      [
        session.businessId,
        session.remoteJid,
        session.customerId,
        session.state,
        JSON.stringify(session.payload),
        session.page,
        session.handoff,
      ],
    );
    return toSession(result.rows[0]!);
  }

  /**
   * Los `messageId` reales de Evolution se deduplican 10 minutos. Las huellas
   * (cuando Evolution no envía id) solo 20 segundos: un reintento real llega en
   * segundos, mientras que respuestas legítimas repetidas ("1" dos veces
   * seguidas en pasos distintos) no deben bloquearse.
   */
  async findTurn(businessId: string, dedupeKey: string): Promise<ConversationTurnResponse | null> {
    const window = dedupeKey.startsWith("msg:") ? "10 minutes" : "20 seconds";
    const result = await this.db.query<{ response: ConversationTurnResponse }>(
      `SELECT response FROM conversation_turns
        WHERE business_id = $1 AND dedupe_key = $2
          AND created_at > now() - $3::interval`,
      [businessId, dedupeKey, window],
    );
    return result.rows[0]?.response ?? null;
  }

  async saveTurn(
    businessId: string,
    remoteJid: string,
    dedupeKey: string,
    response: ConversationTurnResponse,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO conversation_turns (business_id, remote_jid, dedupe_key, response)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (business_id, dedupe_key) DO NOTHING`,
      [businessId, remoteJid, dedupeKey, JSON.stringify(response)],
    );
  }

  /** Categorías padre: activas y sin padre. Nunca productos en este nivel. */
  async listParentCategories(businessId: string, limit: number, offset: number): Promise<CategoryNode[]> {
    const result = await this.db.query<CategoryRow>(
      `SELECT id, name, parent_id FROM categories
        WHERE business_id = $1 AND status = 'active' AND parent_id IS NULL
        ORDER BY name ASC, id ASC
        LIMIT $2 OFFSET $3`,
      [businessId, limit, offset],
    );
    return result.rows.map((row) => ({ id: row.id, name: row.name, parentId: row.parent_id }));
  }

  async countParentCategories(businessId: string): Promise<number> {
    const result = await this.db.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM categories
        WHERE business_id = $1 AND status = 'active' AND parent_id IS NULL`,
      [businessId],
    );
    return result.rows[0]?.count ?? 0;
  }

  async listChildCategories(
    businessId: string,
    parentId: string,
    limit: number,
    offset: number,
  ): Promise<CategoryNode[]> {
    const result = await this.db.query<CategoryRow>(
      `SELECT id, name, parent_id FROM categories
        WHERE business_id = $1 AND status = 'active' AND parent_id = $2
        ORDER BY name ASC, id ASC
        LIMIT $3 OFFSET $4`,
      [businessId, parentId, limit, offset],
    );
    return result.rows.map((row) => ({ id: row.id, name: row.name, parentId: row.parent_id }));
  }

  async countChildCategories(businessId: string, parentId: string): Promise<number> {
    const result = await this.db.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM categories
        WHERE business_id = $1 AND status = 'active' AND parent_id = $2`,
      [businessId, parentId],
    );
    return result.rows[0]?.count ?? 0;
  }

  async findCategory(businessId: string, categoryId: string): Promise<CategoryNode | null> {
    const result = await this.db.query<CategoryRow>(
      `SELECT id, name, parent_id FROM categories
        WHERE business_id = $1 AND id = $2 AND status = 'active'`,
      [businessId, categoryId],
    );
    const row = result.rows[0];
    return row ? { id: row.id, name: row.name, parentId: row.parent_id } : null;
  }

  /** Solo categorías hoja exponen productos vendibles. */
  async listProductsByCategory(
    businessId: string,
    categoryId: string,
    limit: number,
    offset: number,
  ): Promise<ProductNode[]> {
    const result = await this.db.query<ProductRow>(
      `SELECT id, name, description, min_quantity, max_quantity, required_inputs
         FROM products
        WHERE business_id = $1 AND category_id = $2 AND status = 'active'
        ORDER BY name ASC, id ASC
        LIMIT $3 OFFSET $4`,
      [businessId, categoryId, limit, offset],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      minQuantity: row.min_quantity,
      maxQuantity: row.max_quantity,
      requiredInputs: (row.required_inputs ?? []).filter((field) => field.required !== false),
    }));
  }

  async countProductsByCategory(businessId: string, categoryId: string): Promise<number> {
    const result = await this.db.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM products
        WHERE business_id = $1 AND category_id = $2 AND status = 'active'`,
      [businessId, categoryId],
    );
    return result.rows[0]?.count ?? 0;
  }

  async findProduct(businessId: string, productId: string): Promise<ProductNode | null> {
    const result = await this.db.query<ProductRow>(
      `SELECT id, name, description, min_quantity, max_quantity, required_inputs
         FROM products
        WHERE business_id = $1 AND id = $2 AND status = 'active'`,
      [businessId, productId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      minQuantity: row.min_quantity,
      maxQuantity: row.max_quantity,
      requiredInputs: (row.required_inputs ?? []).filter((field) => field.required !== false),
    };
  }

  async listOrdersByCustomer(
    businessId: string,
    customerId: string,
    limit: number,
    offset: number,
  ): Promise<OrderSummary[]> {
    const result = await this.db.query<OrderRow>(
      `SELECT id, status, total, currency, created_at FROM orders
        WHERE business_id = $1 AND customer_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT $3 OFFSET $4`,
      [businessId, customerId, limit, offset],
    );
    return result.rows.map((row) => ({
      id: row.id,
      status: row.status,
      total: row.total,
      currency: row.currency,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  async countOrdersByCustomer(businessId: string, customerId: string): Promise<number> {
    const result = await this.db.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM orders
        WHERE business_id = $1 AND customer_id = $2`,
      [businessId, customerId],
    );
    return result.rows[0]?.count ?? 0;
  }
  /** Moneda del negocio: el pricing es autoritativo, aquí solo aporta contexto. */
  async findBusinessCurrency(businessId: string): Promise<string | null> {
    const result = await this.db.query<{ currency: string }>(
      `SELECT currency FROM businesses WHERE id = $1`,
      [businessId],
    );
    return result.rows[0]?.currency ?? null;
  }
}

export type ConversationRepository = PostgresConversationRepository;
