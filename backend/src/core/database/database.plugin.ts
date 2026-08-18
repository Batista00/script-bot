import type { Pool } from "pg";
import fastifyPlugin from "fastify-plugin";

import { createDatabasePool } from "./database.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Pool;
  }
}

interface DatabasePluginOptions {
  connectionString: string;
}

export const databasePlugin = fastifyPlugin<DatabasePluginOptions>(
  async (app, options) => {
    const pool = createDatabasePool(options.connectionString);

    pool.on("error", (error) => {
      app.log.error({ err: error }, "Unexpected PostgreSQL pool error");
    });

    app.decorate("db", pool);
    app.addHook("onClose", async () => {
      await pool.end();
    });
  },
  { name: "database" },
);
