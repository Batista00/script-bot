import { Pool, type PoolClient } from "pg";

export type DatabaseExecutor = Pick<Pool, "query">;

export function createDatabasePool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

export async function withTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
