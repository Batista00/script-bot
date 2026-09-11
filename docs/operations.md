# Operación de BOT WHATSAP

Guía para poner el sistema en marcha con clientes reales. El detalle de despliegue, backup y rollback vive en [`../deploy/README.md`](../deploy/README.md); este documento cubre configuración, integraciones y verificación.

## 1. Piezas y procesos

| Proceso | Comando | Puertos |
|---|---|---|
| API | `node dist/src/server.js` (`pnpm start`) | `PORT` (3000) |
| Worker de jobs | `node dist/src/worker.js` | ninguno |
| PostgreSQL 16 | contenedor `backend-postgres` | interno |
| Panel admin | archivos estáticos de `admin/dist` tras Nginx | 80/443 |
| Typebot / Evolution / n8n | instalaciones aparte, no las gestiona este repositorio | los suyos |

El worker consume la cola `job_queue` (PostgreSQL) con `FOR UPDATE SKIP LOCKED`. Es la única pieza que despacha pedidos al proveedor, sincroniza estados, reconcilia pagos y poda sesiones vencidas. Puede arrancar antes de que la API termine de migrar: registra el error y reintenta.

## 2. Variables de entorno

Obligatorias en producción: `NODE_ENV`, `PORT`, `DATABASE_URL`, `LOG_LEVEL`, `AUTH_SESSION_TTL_HOURS`, `INTEGRATIONS_ENCRYPTION_KEY` (32 bytes base64, respáldala fuera de la VPS), `PUBLIC_API_BASE_URL` (HTTPS), `POSTGRES_DB/USER/PASSWORD`, `BACKEND_BIND_ADDRESS`, `BACKEND_HOST_PORT`.

Opcionales con default seguro: `TRUST_PROXY` (`loopback`), `AUTH_LOGIN_RATE_LIMIT_MAX` (10) / `_WINDOW_SECONDS` (900), `BOT_RATE_LIMIT_MAX` (600) / `_WINDOW_SECONDS` (60), `WEBHOOK_RATE_LIMIT_MAX` (240) / `_WINDOW_SECONDS` (60) y las `WORKER_*` (`WORKER_POLL_INTERVAL_MS` 2000, `WORKER_BATCH_SIZE` 10, `WORKER_LEASE_SECONDS` 120, `WORKER_RECONCILE_ORDERS_SECONDS` 120, `WORKER_RECONCILE_FULFILLMENTS_SECONDS` 180, `WORKER_RECONCILE_PAYMENTS_SECONDS` 300, `WORKER_PRUNE_SESSIONS_SECONDS` 21600; `0` desactiva un sweep).

Validación previa: `node deploy/scripts/preflight.mjs` (y `--example` para la plantilla).

## 3. Mercado Pago

1. En el panel: **Integraciones → nueva → `mercado_pago`**.
   - `config`: `successUrl`, `pendingUrl`, `failureUrl` (las tres juntas, opcionales).
   - `credentials`: `accessToken` y `webhookSecret` (los entrega Mercado Pago; se cifran con AES-256-GCM).
2. Pulsa **Probar conexión**: llama a `GET /users/me` con el token. Si ves `PAYMENT_PROVIDER_CREDENTIALS_INVALID`, el token está revocado o es de otra cuenta.
3. En Mercado Pago, configura la notificación de pagos hacia `https://TU_API/webhooks/mercado-pago/<integrationId>`. El `<integrationId>` está en la URL del panel al abrir la integración.
4. Verifica con una compra de prueba: el webhook consulta el pago server-to-server y solo entonces marca `approved` + `paid`. Si el webhook nunca llega, el worker reconcilia los pagos pendientes que ya tienen `provider_payment_id`; un pago sin webhook ni id de pago no se aprueba solo.

Estados soportados: `pending`, `approved`, `rejected`, `cancelled`, `expired`, `failed`, más `refunded` y `chargeback` (que marcan el pedido como `failed` cuando aún estaba `paid`/`processing` para revisión operativa).

## 4. SMM Raja (proveedor mayorista)

1. Crea la integración con `providerKey: smm_raja` y `credentials: { apiKey: "..." }`.
2. Pulsa **Probar conexión** en Servicios de proveedor: consulta el saldo y guarda el estado de conexión.
3. **Sincronizar servicios** importa el catálogo (`services` + `balance`). Los servicios ausentes se desactivan, nunca se borran.
4. Importa un servicio como producto (**Importar producto**): define nombre comercial, descripción, categoría, SKU, límites, moneda, modelo de precio, precio retail y los campos que el cliente debe completar (`requiredInputs`). El rate del proveedor nunca se convierte en precio retail.
5. Vincula el producto con el servicio externo mediante el **mapping** (un mapping activo por producto). Sin mapping no hay fulfillment.

Los campos explícitos del servicio (`rate`, `min`, `max`, `supportsRefill`, `supportsCancel`, `providerStatus`) provienen del catálogo sincronizado; el costo del proveedor se puede volver a sincronizar sin tocar tu precio.

> **REQUIERE_CREDENCIAL**: sin `apiKey` real no se puede verificar contra la API de SMM Raja. Nunca lances pedidos reales al proveedor sin autorización explícita.

## 5. Credencial de bot (machine auth)

1. En el panel: **API Credentials → Crear credential** (solo owner/admin). El token `bw_...` se muestra **una sola vez**; guárdalo en el gestor de secretos del orquestador.
2. **Rotación**: crea una credencial nueva, actualiza el orquestador y desactiva la anterior. No hay recuperación del token.
3. **Revocación**: desactiva la credencial (`PATCH .../api-credentials/:id`, `status: inactive`). El Bot Gateway responde 401 de inmediato.
4. El token **nunca** se escribe en el JSON de Typebot ni en el repositorio: se inyecta en runtime como variable de sesión (por ejemplo, al iniciar la conversación desde Evolution) y el template lo consume como `{{backend_token}}`.

La credencial da acceso al Bot Gateway del negocio (catálogo activo, quotes, orders, payments y estado de fulfillments). Límite por defecto: 600 peticiones/minuto por credencial (`BOT_RATE_LIMIT_*`).

## 6. Typebot

1. Importa `typebot/bot-whatsap-commerce-v1.json` (esquema 6.1).
2. Define en la instalación self-hosted, como variables de sesión, `backend_base_url` (URL pública sin barra final, no secreta) y `backend_token` (credencial del paso 5, secreta).
3. El flujo consulta el catálogo real, pide cantidad, obtiene el precio del backend, crea quote y order (con los `fulfillmentInput` que el producto requiera), lista métodos de pago reales y consulta el estado del pago, del pedido y del fulfillment.
4. Valida el template antes de importarlo: `node typebot/validate-typebot.mjs`.

El bot no calcula precios, no aprueba pagos y no conoce identificadores ni costos del proveedor.

## 7. Evolution API (WhatsApp)

1. Crea la integración con `providerKey: evolution`, `config: { "baseUrl": "https://evo.tu-dominio", "instance": "nombre-instancia" }` y `credentials: { "apiKey": "...", "webhookSecret": "un-secreto-largo" }`.
2. En Evolution, apunta el webhook de mensajes a `https://TU_API/webhooks/evolution/<integrationId>` con el header `x-webhook-secret: <webhookSecret>`.
3. El backend normaliza el teléfono (`@s.whatsapp.net`, `@c.us`, sufijo `:NN`), resuelve o crea el customer, guarda la conversación y el mensaje (idempotente por id de mensaje) y devuelve el contexto que el orquestador usa para continuar el flujo en Typebot.
4. Para responder, usa el Bot Gateway (si el orquestador maneja el envío) o `POST /businesses/:businessId/conversations/:conversationId/messages` (owner/admin/operator) para enviar y registrar el mensaje saliente.
5. **Handoff humano**: `PATCH /businesses/:businessId/conversations/:conversationId` con `{"status":"human"}` deja la conversación marcada para atención manual.

> **REQUIERE_CREDENCIAL**: `apiKey` y una instancia real de Evolution. No modifiques ni redesplegues la instancia productiva durante las pruebas.

## 8. n8n

1. Define en el proceso de n8n: `BACKEND_BASE_URL`, `BUSINESS_ID`, `BACKEND_BOT_TOKEN` (credencial del paso 5) y `ALERT_WEBHOOK_URL` (opcional; sin ella los workflows terminan en un NoOp documentado).
2. Importa los JSON de `n8n/` y déjalos **inactivos** hasta probarlos: `alertas-operativas.json` (jobs fallidos), `alertas-fulfillment.json` (`submission_unknown`), `reporte-diario.json` y `reconciliacion-manual.json`.
3. n8n solo lee el backend y notifica; el único efecto es el `retry` de un job, que el backend autoriza con rol owner/admin. n8n no aprueba pagos ni escribe estados.
4. Valida los workflows: `node n8n/validate-n8n.mjs`.

## 9. Worker y mantenimiento

- Arranque en Compose: servicio `backend-worker` (misma imagen, `node dist/src/worker.js`, sin puertos). Ver `deploy/README.md`.
- Comprobación: `bash deploy/scripts/worker-status.sh` y en el panel **Operaciones → Jobs** (filtra `failed`). Cada job muestra tipo, intentos, próxima ejecución y último error, con botón de reintento para owner/admin.
- Reintentos: backoff exponencial (base 30 s, tope 1 h) hasta `max_attempts`. Los sweeps de mantenimiento reabren jobs fallidos cuando el trabajo sigue pendiente, así que corregir la causa (mapping, credencial) es suficiente para que el siguiente ciclo lo resuelva.
- Un fulfillment en `submission_unknown` **no se reintenta**: el proveedor pudo haber creado el pedido. Revísalo manualmente antes de cualquier acción.

## 10. Verificación y venta de prueba

1. Salud: `curl -fsS https://TU_API/health` (liveness) y `curl -fsS https://TU_API/health/ready` (PostgreSQL). El healthcheck del contenedor usa `/health` a propósito, para no reiniciar por un corte transitorio de base de datos.
2. Venta de prueba **sin dinero real**: crea un producto con precio bajo, emite una cotización, crea el pedido, elige **transferencia bancaria** y confírmala desde el panel (**Pagos → Confirmar abono**). El pedido pasa a `paid`, el worker crea el fulfillment y lo envía al proveedor.
3. Sigue el resultado en **Pedidos** y **Fulfillments**, y en **Jobs** si algo falla. Usa una cuota mínima y un servicio barato del proveedor; **no lances pedidos reales a SMM Raja sin autorización**.
4. Si necesitas validar el camino completo sin proveedor real, usa la suite `backend/tests/integration/commerce-flow.integration.test.ts`, que ejecuta el flujo íntegro contra un adapter de prueba.
