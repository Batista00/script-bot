# Backend de BOT WHATSAP

Backend comercial modular con Fastify, configuración validada, PostgreSQL, migraciones versionadas, autenticación por sesión y administración mínima de negocios.

Incluye Payments Core independiente de proveedores y el adaptador inicial de Mercado Pago Checkout Pro para pagos CLP.

## Requisitos

- Node.js 22 o superior
- pnpm 11.19 (declarado en `package.json`; los scripts también pueden iniciarse con npm)
- PostgreSQL 16, local o mediante Docker Compose

## Desarrollo local

```bash
cp .env.example .env
pnpm install
pnpm dev
```

El servicio escucha en `http://localhost:3000` por defecto.

```bash
curl http://localhost:3000/health
```

Respuesta esperada:

```json
{"status":"ok"}
```

## Scripts

```bash
pnpm dev
pnpm build
pnpm start
pnpm test
pnpm typecheck
pnpm migrate
pnpm migrate:down
pnpm bootstrap:owner
```

`pnpm migrate` utiliza `DATABASE_URL` y aplica únicamente migraciones pendientes. `migrate:down` revierte una migración y debe utilizarse de forma deliberada. Una migración aplicada nunca se edita: cualquier cambio posterior se agrega como una migración nueva.

Las pruebas de integración PostgreSQL están separadas en `tests/integration/`. Se ejecutan dentro de `pnpm test`, pero quedan marcadas como omitidas si no se define una base exclusiva mediante `TEST_DATABASE_URL`.

GitHub Actions levanta PostgreSQL 16 en una base efímera exclusiva de CI, aplica todas las migraciones y ejecuta estas integraciones con `TEST_DATABASE_URL`. El mismo job valida instalación congelada, typecheck y build.

## Clave de integraciones

Las credenciales de integraciones se cifran con AES-256-GCM mediante una clave maestra base64 de 32 bytes. Genera una clave nueva con Node.js y guárdala únicamente en el gestor seguro del entorno:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Configura el resultado como `INTEGRATIONS_ENCRYPTION_KEY`. La variable queda vacía en `.env.example`; el backend nunca genera una clave silenciosamente ni la guarda en PostgreSQL. Si una operación necesita cifrar o descifrar y la clave no está configurada, falla explícitamente.

## Autenticación y primer owner

Las sesiones son tokens opacos enviados únicamente en la cookie `bot_whatsap_session`. La base guarda su hash SHA-256, nunca el token original. La cookie es `HttpOnly`, `SameSite=Lax`, usa `Secure` en producción y expira según `AUTH_SESSION_TTL_HOURS`.

Endpoints:

- `POST /auth/login`: recibe `email` y `password`.
- `GET /auth/me`: devuelve el usuario y sus negocios con rol, sin hashes.
- `POST /auth/logout`: invalida la sesión actual y limpia la cookie.

No existe registro público. Después de aplicar las migraciones, crea el primer negocio y su owner mediante variables de entorno temporales:

```bash
BOOTSTRAP_BUSINESS_NAME="Nombre del negocio" \
BOOTSTRAP_OWNER_NAME="Nombre Owner" \
BOOTSTRAP_OWNER_EMAIL="owner@example.com" \
BOOTSTRAP_OWNER_PASSWORD="una-clave-segura" \
pnpm bootstrap:owner
```

El script crea el negocio, el usuario y su membresía `owner` en una sola transacción. Si ya existe cualquier usuario, se rechaza porque el sistema se considera inicializado. No guardes esos valores reales en `.env` ni en el repositorio.

Todos los endpoints `/businesses` requieren sesión. El listado contiene solo negocios asociados al usuario; consultar uno exige membresía; editarlo exige rol `owner` o `admin`. Al crear un negocio, el usuario autenticado obtiene el rol `owner` dentro de la misma transacción.

## Machine Auth y Bot Gateway

La API humana y la API para automatizaciones usan credenciales completamente separadas:

```text
Human API  → cookie de sesión + membership owner/admin/operator
Bot Gateway → Authorization: Bearer <BOT_BACKEND_TOKEN>
```

Solo `owner` y `admin` administran credenciales machine-to-machine mediante:

```text
POST  /businesses/:businessId/api-credentials
GET   /businesses/:businessId/api-credentials
GET   /businesses/:businessId/api-credentials/:credentialId
PATCH /businesses/:businessId/api-credentials/:credentialId
```

El POST genera un token opaco `bw_...`, almacena únicamente su hash SHA-256 y devuelve el token completo una sola vez. Los GET solo muestran su prefijo identificador. Para rotar se crea una credencial nueva y después se desactiva la anterior; no hay DELETE físico.

El Bot Gateway se publica bajo `/bot/v1/*`. `businessId` siempre se deriva de la credencial Bearer activa y nunca se acepta en paths o bodies del bot. Expone Customer Resolve, catálogo comercial activo, Quotes, Orders, Checkout de Payments y Fulfillments mediante DTOs que no incluyen costes de proveedor, credenciales ni campos internos.

Contrato conceptual para una futura conexión Typebot:

```http
Authorization: Bearer <BOT_BACKEND_TOKEN>
Content-Type: application/json
```

El token machine permanece en credenciales n8n; no se incluye en templates ni exports JSON de Typebot. El flujo nuevo usa tokens temporales acotados a una conversación. Ver [flujos importables](../flows/CONFIGURACION.md).

El catálogo también ofrece `GET /bot/v1/catalog/packages?categoryId=<uuid>` para servicios configurados como paquetes de cantidad fija. El precio expuesto es siempre el precio retail activo del negocio; nunca se publica el coste del proveedor.

`POST /bot/v1/assistant/message` clasifica mensajes con Machine Auth y Structured Outputs. La integración es opcional: usa `OPENAI_API_KEY`, `OPENAI_MODEL` y `OPENAI_TIMEOUT_MS`; si no hay clave, devuelve un fallback seguro sin bloquear el resto del Gateway. La IA sólo interpreta intención y entidades, y no aprueba pagos ni ejecuta pedidos.

## Customers

Los customers siempre pertenecen a un negocio y no dependen de proveedores externos. Los roles `owner`, `admin` y `operator` del negocio pueden crear, listar, consultar y actualizar mediante:

```text
POST  /businesses/:businessId/customers
GET   /businesses/:businessId/customers
GET   /businesses/:businessId/customers/:customerId
PATCH /businesses/:businessId/customers/:customerId
```

Cada customer requiere teléfono o email. El listado admite `limit`, `offset` y filtros exactos opcionales `phone` y `email`. `DELETE /businesses/:businessId/customers/:customerId` elimina únicamente clientes sin historial; ante Quotes u Orders responde `409 CUSTOMER_HAS_COMMERCIAL_HISTORY` y corresponde desactivarlos.

## Catálogo

`categories` y `products` forman el catálogo propio de cada negocio. Los roles `owner` y `admin` pueden crear y actualizar; `operator` tiene acceso de lectura. Ambos recursos se administran bajo `/businesses/:businessId/categories` y `/businesses/:businessId/products`, con paginación y filtros sencillos. `DELETE /businesses/:businessId/products/:productId` sólo elimina Products sin Quotes, Orders o Fulfillments; si hay historial devuelve `409 PRODUCT_HAS_COMMERCIAL_HISTORY` y debe usarse desactivación.

Los productos pueden existir sin categoría ni SKU. Sus nombres, descripciones, límites y precios siguen siendo propiedad del negocio; nunca se sobrescriben desde un proveedor externo.

## Provider Catalog y SMM Raja

`Provider Service` representa un servicio mayorista observado en una integración y es distinto del `Product` comercial propio. Conserva nombre y descripción originales, rate decimal, límites, capacidades de pedido y metadata segura del proveedor sin modificar Products ni Pricing. El rate permanece como string decimal respaldado por PostgreSQL `NUMERIC`; no es un precio retail y no se convierte de moneda.

Endpoints de lectura y sincronización:

```text
GET  /businesses/:businessId/provider-services
GET  /businesses/:businessId/provider-services/:providerServiceId
POST /businesses/:businessId/integrations/:integrationId/provider-services/sync
GET  /businesses/:businessId/integrations/:integrationId/provider-catalog/state
POST /businesses/:businessId/provider-services/import-product
```

La primera integración de catálogo usa `providerKey: "smm_raja"` y credenciales cifradas:

```json
{
  "providerKey": "smm_raja",
  "credentials": {
    "apiKey": "valor-entregado-por-smm-raja"
  }
}
```

El sync consulta `action=services` y `action=balance` fuera de cualquier transacción, aísla registros individuales inválidos y después ejecuta un upsert corto. Devuelve `received`, `normalized`, `rejected` y razones de rechazo; servicios ausentes se marcan `inactive`, nunca se borran. Estado de conexión, saldo y última sync se guardan en `provider_catalog_states`. La API key no aparece en respuestas, metadata ni logs.

`import-product` recibe un Provider Service activo y los campos retail editables (`name`,
`description`, `categoryId`, `sku`, `type`, límites, moneda, modelo de precio, precio, estado y
`requiredInputs`). Crea Product, configuración comercial de inputs, Pricing y mapping en una sola
transacción PostgreSQL; un fallo en cualquiera de las etapas hace rollback completo. También vuelve a bloquear la integración activa antes
de escribir y rechaza IDs pertenecientes a otro Business.

Los rechazos explícitos del proveedor, respuestas inválidas e indisponibilidad se traducen a
códigos seguros diferentes. Los logs sólo incluyen Business, integración, provider key y código
de fallo; nunca API keys ni el body devuelto por el proveedor.

Un Product se vincula explícitamente con un Provider Service mediante:

```text
POST  /businesses/:businessId/products/:productId/provider-mapping
GET   /businesses/:businessId/products/:productId/provider-mapping
PATCH /businesses/:businessId/products/:productId/provider-mapping
```

Solo puede existir un mapping activo por Product. `owner` y `admin` sincronizan y modifican mappings; `operator` tiene acceso de lectura. El rate mayorista no se utiliza para recalcular Quotes, Orders ni Payments.

## Fulfillment y órdenes SMM Raja

Un `Fulfillment` representa la entrega externa de un único `OrderItem`; nunca sustituye al Order. Solo un Order `paid` puede despacharse. El backend resuelve internamente el mapping activo, guarda un snapshot de integración/servicio/provider y llama a `action=add` fuera de la transacción PostgreSQL. La confirmación cambia atómicamente el Fulfillment a `submitted` y el Order de `paid` a `processing`.

```text
Payment approved → Order paid → Fulfillment dispatch → SMM Raja order
                 → status sync → Order completed / failed
```

Endpoints disponibles para `owner`, `admin` y `operator`:

```text
POST /businesses/:businessId/orders/:orderId/fulfillments
GET  /businesses/:businessId/orders/:orderId/fulfillments
GET  /businesses/:businessId/fulfillments
GET  /businesses/:businessId/fulfillments/:fulfillmentId
POST /businesses/:businessId/fulfillments/:fulfillmentId/sync-status
```

El listado global admite `limit`, `offset` y `status`; está aislado por Business y omite `inputData` para ofrecer una vista administrativa segura.

El retry explícito `POST /businesses/:businessId/fulfillments/:fulfillmentId/retry` está limitado a `owner` y `admin` y únicamente acepta Fulfillments `failed`. Como SMM Raja no documenta una idempotency key para `action=add`, un timeout o una respuesta imposible de interpretar después del POST produce `submission_unknown`: no existe retry automático y ese estado tampoco admite retry manual, porque podría duplicar la compra externa.

`action=status` persiste el estado externo sanitizado y métricas válidas. Un estado desconocido no inventa una transición local. `Completed` finaliza el Order cuando todos sus Fulfillments terminaron; `Partial` o `Cancelled` lo dejan `failed` para atención operativa. El módulo opcional de ventas automatiza seguimiento y dispatch únicamente si el negocio lo habilita y ejecuta su worker autenticado.

## Pricing y Quotes

El flujo comercial actual es `Product → Pricing → Quote`. Las reglas `fixed` permiten paquetes de precio único y las reglas `unit` cobran por cantidad. Pertenecen al negocio, usan obligatoriamente `business.currency` y se administran bajo `/businesses/:businessId/products/:productId/prices`. Sus rangos activos son inclusivos y no pueden superponerse. Un Price puede eliminarse porque Quotes y Orders conservan snapshots monetarios propios.

Los montos se guardan como enteros PostgreSQL `bigint` y la API solo acepta enteros positivos hasta `Number.MAX_SAFE_INTEGER`; por ejemplo, `15990` representa `$15.990 CLP`. No se usan decimales de coma flotante ni conversión de monedas.

Los quotes se crean y consultan bajo `/businesses/:businessId/quotes`. Cada quote conserva un snapshot del nombre del producto y del cálculo aplicado, por lo que los cambios posteriores de producto o pricing no alteran su valor histórico. Un quote `active` vencido se presenta como `expired` al leerlo, sin actualizar PostgreSQL como efecto secundario del GET.

## Orders

El flujo comercial actual es `Product → Pricing → Quote → Order`. Un Order se crea convirtiendo atómicamente un Quote válido mediante `POST /businesses/:businessId/orders`; el Order y su Item copian el snapshot del Quote sin consultar el producto ni recalcular Pricing. Cada Quote puede convertirse una sola vez.

Los roles `owner`, `admin` y `operator` pueden crear y leer Orders. Solo `owner` y `admin` pueden cancelar explícitamente un Order en estado `pending_payment`. Los Orders nacen siempre como `pending_payment`; no existe un endpoint para marcarlos manualmente como pagados.

## Payments Core

El flujo comercial llega ahora a `Order → Payment → PaymentProvider`. Payments copia monto, moneda y customer desde el Order y nunca acepta esos datos desde el caller. Los roles `owner`, `admin` y `operator` pueden crear intentos y consultarlos mediante:

```text
POST /businesses/:businessId/orders/:orderId/payments
GET  /businesses/:businessId/payments
GET  /businesses/:businessId/payments/:paymentId
GET  /businesses/:businessId/orders/:orderId/payments
```

La creación admite el header opcional `Idempotency-Key` y, para clientes nuevos, `paymentMethodId`; `providerKey` se conserva por compatibilidad. Los métodos activos se administran en `/businesses/:businessId/payment-methods` y el Bot Gateway los publica en `GET /bot/v1/payment-methods`.

`bank_transfer` conserva titular, RUT chileno, banco, tipo y número de cuenta, más correo opcional. El Payment nace siempre `pending`: únicamente owner/admin puede confirmar un abono ya verificado mediante `POST /businesses/:businessId/payments/:paymentId/confirm-bank-transfer` con una referencia. Mercado Pago continúa aprobándose exclusivamente por webhook verificado. Ningún bot ni IA posee la ruta de confirmación manual.

El runtime registra `mercado_pago`. Al crear un intento, el adaptador genera una preferencia Checkout Pro y devuelve su `checkoutUrl`. El `preference_id` se conserva como `providerReferenceId`; el `payment_id` definitivo permanece separado y solo se enlaza después de verificar una notificación contra la API de Mercado Pago.

La moneda global del negocio se configura en `PATCH /businesses/:businessId` (`currency`, ISO 4217). Pricing, Quote, Order y Payment operan en esa moneda sin convertir el rate USD del proveedor. Mercado Pago actualmente acepta solo CLP y devuelve `PAYMENT_PROVIDER_CURRENCY_NOT_SUPPORTED` para otra moneda; transferencia bancaria conserva la moneda del Order.

Mercado Pago se configura como una integración activa del negocio con:

```json
{
  "providerKey": "mercado_pago",
  "config": {
    "successUrl": "https://commerce.example.com/payment/success",
    "pendingUrl": "https://commerce.example.com/payment/pending",
    "failureUrl": "https://commerce.example.com/payment/failure"
  },
  "credentials": {
    "publicKey": "public-key-entregada-por-mercado-pago",
    "accessToken": "valor-entregado-por-mercado-pago",
    "webhookSecret": "firma-secreta-del-webhook"
  }
}
```

El alta desde el panel ocurre en dos pasos. Primero exige `publicKey` y `accessToken`, crea la integración `inactive` y muestra la URL generada `POST /webhooks/mercado-pago/:integrationId`. Después de registrar esa URL para el evento Pagos en Mercado Pago Developers, se reingresan ambas credenciales junto con el `webhookSecret` generado por Mercado Pago y se activa la integración. Ningún pago puede usarla mientras permanezca inactiva o incompleta.

`publicKey`, `accessToken` y `webhookSecret` quedan cifrados por Integrations Core y nunca se devuelven por HTTP. El adapter normaliza un prefijo `Bearer` pegado por error y agrega exactamente un único esquema al llamar a Mercado Pago. Las tres back URLs son opcionales si todavía no existe una página de resultado, pero deben configurarse juntas y solo se envían cuando están completas. `PUBLIC_API_BASE_URL` debe ser la base pública HTTPS del backend, sin secretos; fuera de tests no se admite HTTP.

El webhook es público porque Mercado Pago no posee una sesión del sistema, pero exige la firma HMAC de Mercado Pago. El body no aprueba pagos: el backend consulta `GET /v1/payments/:id` con el token interno y valida negocio, provider, referencia local, monto y moneda antes de aplicar una transición. Solo `approved` confirmado paga el Order en la misma transacción; los redirects del navegador nunca determinan aprobación. Refunds y chargebacks no se implementan en esta etapa.

## Integrations Core

Las configuraciones provider-agnostic pertenecen a cada Business. `config` conserva únicamente opciones no secretas y `credentials_encrypted` almacena el objeto de credenciales cifrado; ninguna respuesta HTTP expone secretos ni ciphertext.

```text
POST  /businesses/:businessId/integrations
GET   /businesses/:businessId/integrations
GET   /businesses/:businessId/integrations/:integrationId
PATCH /businesses/:businessId/integrations/:integrationId
```

Solo `owner` y `admin` pueden administrar integraciones. Los accesos internos por Business/provider y por ID exacto entregan configuración y credenciales descifradas únicamente a adapters; no están publicados como endpoints. Mercado Pago, Raja, Telegram y el ejecutor de automatizaciones usan este contrato. Evolution se conecta mediante los workflows n8n versionados en `flows/`, no desde el dominio Orders.

## Ventas conversacionales y revisión humana

La migración `000015` agrega sesiones comerciales, inbox durable, checkouts con datos de entrega, revisión cifrada de comprobantes, revisores Telegram y cola de notificaciones. No se activa ninguna automatización al migrar.

En el panel **Bot y automatizaciones**, owner/admin configura atención, pausa conversaciones, vincula su usuario Telegram, registra entregas manuales de pedidos pagados y recupera trabajos fallidos. Configuración, secretos y clientes se aíslan por negocio.

- Machine API: `POST /bot/v1/sales/sessions` y `/bot/v1/sales/inbox`.
- Token temporal de conversación: `POST /conversation/v1/message`, `/evidence`, `/evidence/analysis`.
- Runner independiente: `POST /automation/v1/:integrationId/tick`, `/inbox/claim`, `/inbox/ack`, `/notifications/claim`, `/notifications/ack`.
- Telegram: `POST /webhooks/telegram/:integrationId`, con header secreto y revisor humano autorizado.
- Administración: `/businesses/:businessId/sales-automation` y sus subrutas protegidas; no hay una ruta pública de aprobación por IA.

Producto/cantidad/datos de entrega se validan antes de ofrecer pago. El precio proviene de Pricing; las acciones financieras continúan en Payments/Orders. Las observaciones opcionales de OpenAI no autorizan nada. Una transferencia requiere verificación humana del abono y referencia bancaria; Mercado Pago conserva su verificación server-to-server.

Los tests de ventas (`pnpm test:sales`) forman parte de `pnpm test`. PostgreSQL continúa serializado con `--test-concurrency=1`; sin `TEST_DATABASE_URL` se informa skip. Las pruebas no envían WhatsApp/Telegram ni compran servicios.

Consultar [configuración e importación](../flows/CONFIGURACION.md), [operación y límites](../flows/OPERACION.md) y [arquitectura de ventas](docs/sales-automation.md). Los exports apuntan a Evolution 2.3.4 y formato Typebot 6.1; falta verificar su importación en las versiones reales del VPS, incluida n8n.

## Docker Compose

Después de crear `.env` desde `.env.example` y cambiar sus credenciales de ejemplo:

```bash
docker compose up -d postgres
docker compose run --rm api pnpm migrate
docker compose up -d api
```

Consulta [docs/architecture.md](docs/architecture.md) para las reglas de crecimiento del backend.
