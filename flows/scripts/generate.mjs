import { mkdir,writeFile } from "node:fs/promises";
import { ingress } from "./build-ingress.mjs";
import { bridge } from "./build-bridge.mjs";
import { salesWorker } from "./build-sales-worker.mjs";
import { notifications } from "./build-notifications.mjs";
import { typebot } from "./build-typebot.mjs";

for(const [path,value] of [
  ["n8n/01-evolution-inbox.json",ingress()],
  ["n8n/02-typebot-sales-bridge.json",bridge()],
  ["n8n/03-sales-worker.json",salesWorker()],
  ["n8n/04-notifications-worker.json",notifications()],
  ["typebot/sales-assistant-6.1.json",typebot()],
]) {
  const target=new URL(`../${path}`,import.meta.url);
  await mkdir(new URL(".",target),{recursive:true});
  await writeFile(target,JSON.stringify(value,null,2)+"\n");
}
console.log("Generated Typebot 6.1 and inactive n8n exports (no credentials).");
