# Flujos de ventas multinegocio

Estado: implementación local; sin activar, importar ni probar cuentas de producción.

- `typebot/sales-assistant-6.1.json`: presentación Typebot 6.1; una ejecución por mensaje. El estado comercial se conserva en el backend.
- `n8n/01-evolution-inbox.json`: recibe Evolution 2.3.4 y persiste el mensaje antes de confirmar recepción.
- `n8n/02-typebot-sales-bridge.json`: valida la sesión con el backend y usa OpenAI únicamente para asesoría.
- `n8n/03-sales-worker.json`: procesa mensajes pendientes y comprobantes privados.
- `n8n/04-notifications-worker.json`: reconcilia pedidos pagados, despacha servicios habilitados y envía notificaciones con confirmación de entrega.

Lee [CONFIGURACION.md](CONFIGURACION.md) antes de importar. Importar no sustituye desplegar backend/migraciones, seleccionar credenciales y configurar webhooks.

Los exports no tienen claves, chat IDs reales, IDs de credenciales ni datos fijados de ejecuciones.
La versión n8n instalada no se ha confirmado; los tipos/versiones de nodos están explícitos en los exports.

Regeneración determinística desde la raíz: `node flows/scripts/generate.mjs`.
Validación offline: `node --test flows/tests/*.test.mjs` (la lista explícita está documentada en CONFIGURACION para Windows).

Las pruebas reales de WhatsApp, Telegram, OpenAI, pagos y Raja se realizan después, con autorización.
