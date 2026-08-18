import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";

async function start(): Promise<void> {
  const config = loadEnv();
  const app = await buildApp(config);

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    app.log.info({ signal }, "Shutting down");
    await app.close();
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({
    host: "0.0.0.0",
    port: config.PORT,
  });
}

start().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

