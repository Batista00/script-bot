# Flujos de ventas multinegocio

Estado: exports generados y validados; se importan desactivados y requieren asignar credenciales.

- `typebot/sales-assistant-6.1.json`: conversación externa persistente Typebot 6.1, espera el siguiente turno y contiene el único prompt maestro OpenAI de ventas.
- `n8n/01-evolution-inbox.json`: recibe Evolution 2.3.4, persiste primero y dispara procesamiento inmediato.
- `n8n/02-typebot-sales-bridge.json`: valida la sesión y comunica Typebot con el backend; no llama OpenAI.
- `n8n/03-sales-worker.json`: usa `startChat` sólo al crear/reponer sesión y `continueChat` en turnos posteriores; procesa comprobantes sin IA financiera.
- `n8n/04-notifications-worker.json`: intenta entrega inmediata en burbujas ordenadas y conserva el schedule como recuperación durable.

Lee [CONFIGURACION.md](CONFIGURACION.md) antes de importar. Importar no sustituye desplegar backend/migraciones, seleccionar credenciales y configurar webhooks.

Los exports no tienen claves, chat IDs reales, IDs de credenciales ni datos fijados de ejecuciones.
Los tipos/versiones de nodos están explícitos y se verificaron contra n8n 2.36.7, Typebot 6.1 y Evolution API 2.3.4 del despliegue.

Regeneración determinística desde la raíz: `node flows/scripts/generate.mjs`.
Validación offline: `node --test flows/tests/*.test.mjs` (la lista explícita está documentada en CONFIGURACION para Windows).

Las pruebas reales de WhatsApp, Telegram, OpenAI, pagos y Raja se realizan después, con autorización.
