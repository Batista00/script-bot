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

## Customers

Los customers siempre pertenecen a un negocio y no dependen de proveedores externos. Los roles `owner`, `admin` y `operator` del negocio pueden crear, listar, consultar y actualizar mediante:

```text
POST  /businesses/:businessId/customers
GET   /businesses/:businessId/customers
GET   /businesses/:businessId/customers/:customerId
PATCH /businesses/:businessId/customers/:customerId
```

Cada customer requiere teléfono o email. El listado admite `limit`, `offset` y filtros exactos opcionales `phone` y `email`. Para desactivar se actualiza `status` a `inactive`; no existe eliminación física.

## Catálogo

`categories` y `products` forman el catálogo propio de cada negocio. Los roles `owner` y `admin` pueden crear y actualizar; `operator` tiene acceso de lectura. Ambos recursos se administran bajo `/businesses/:businessId/categories` y `/businesses/:businessId/products`, con paginación y filtros sencillos.

Los productos pueden existir sin categoría ni SKU. Sus nombres, descripciones, límites y precios siguen siendo propiedad del negocio; nunca se sobrescriben desde un proveedor externo.

## Provider Catalog y SMM Raja

`Provider Service` representa un servicio mayorista observado en una integración y es distinto del `Product` comercial propio. Conserva el nombre original, rate decimal, límites y metadata del proveedor sin modificar Products ni Pricing. El rate permanece como string decimal respaldado por PostgreSQL `NUMERIC`; no es un precio retail y no se convierte de moneda.

Endpoints de lectura y sincronización:

```text
GET  /businesses/:businessId/provider-services
GET  /businesses/:businessId/provider-services/:providerServiceId
POST /businesses/:businessId/integrations/:integrationId/provider-services/sync
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

El sync consulta `action=services` fuera de cualquier transacción, valida toda la respuesta y después ejecuta un upsert corto. Servicios ausentes se marcan `inactive`, nunca se borran. La API key no aparece en respuestas, metadata ni logs.

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
GET  /businesses/:businessId/fulfillments/:fulfillmentId
POST /businesses/:businessId/fulfillments/:fulfillmentId/sync-status
```

El retry explícito `POST /businesses/:businessId/fulfillments/:fulfillmentId/retry` está limitado a `owner` y `admin` y únicamente acepta Fulfillments `failed`. Como SMM Raja no documenta una idempotency key para `action=add`, un timeout o una respuesta imposible de interpretar después del POST produce `submission_unknown`: no existe retry automático y ese estado tampoco admite retry manual, porque podría duplicar la compra externa.

`action=status` persiste el estado externo sanitizado y métricas válidas. Un estado desconocido no inventa una transición local. `Completed` finaliza el Order cuando todos sus Fulfillments terminaron; `Partial` o `Cancelled` lo dejan `failed` para atención operativa. No hay polling, workers ni dispatch automático en esta etapa.

## Pricing y Quotes

El flujo comercial actual es `Product → Pricing → Quote`. Las reglas de precio `fixed` y `unit` pertenecen al negocio y se administran bajo `/businesses/:businessId/products/:productId/prices`. Sus rangos activos son inclusivos y no pueden superponerse para el mismo producto y moneda.

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

La creación admite el header opcional `Idempotency-Key`. Solo una actualización confirmada por un `PaymentProvider` puede aprobar un Payment y cambiar atómicamente su Order de `pending_payment` a `paid`; no existe una ruta de aprobación manual.

El runtime registra `mercado_pago`. Al crear un intento, el adaptador genera una preferencia Checkout Pro y devuelve su `checkoutUrl`. El `preference_id` se conserva como `providerReferenceId`; el `payment_id` definitivo permanece separado y solo se enlaza después de verificar una notificación contra la API de Mercado Pago.

La moneda soportada inicialmente es únicamente `CLP`, usando el monto entero del Order sin dividirlo ni convertirlo. Otra moneda devuelve `PAYMENT_PROVIDER_CURRENCY_NOT_SUPPORTED`.

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
    "accessToken": "valor-entregado-por-mercado-pago",
    "webhookSecret": "firma-secreta-del-webhook"
  }
}
```

`accessToken` y `webhookSecret` quedan cifrados por Integrations Core. Las tres back URLs son opcionales, pero se envían juntas cuando están todas configuradas. `PUBLIC_API_BASE_URL` debe ser la base pública HTTPS del backend, sin secretos; se utiliza para construir `POST /webhooks/mercado-pago/:integrationId`. Fuera de tests no se admite HTTP.

El webhook es público porque Mercado Pago no posee una sesión del sistema, pero exige la firma HMAC de Mercado Pago. El body no aprueba pagos: el backend consulta `GET /v1/payments/:id` con el token interno y valida negocio, provider, referencia local, monto y moneda antes de aplicar una transición. Solo `approved` confirmado paga el Order en la misma transacción; los redirects del navegador nunca determinan aprobación. Refunds y chargebacks no se implementan en esta etapa.

## Integrations Core

Las configuraciones provider-agnostic pertenecen a cada Business. `config` conserva únicamente opciones no secretas y `credentials_encrypted` almacena el objeto de credenciales cifrado; ninguna respuesta HTTP expone secretos ni ciphertext.

```text
POST  /businesses/:businessId/integrations
GET   /businesses/:businessId/integrations
GET   /businesses/:businessId/integrations/:integrationId
PATCH /businesses/:businessId/integrations/:integrationId
```

Solo `owner` y `admin` pueden administrar integraciones. Los accesos internos por Business/provider y por ID exacto entregan configuración y credenciales descifradas únicamente a adapters; no están publicados como endpoints. Mercado Pago y el catálogo SMM Raja usan este contrato. Evolution todavía no está implementado.

## Docker Compose

Después de crear `.env` desde `.env.example` y cambiar sus credenciales de ejemplo:

```bash
docker compose up -d postgres
docker compose run --rm api pnpm migrate
docker compose up -d api
```

Consulta [docs/architecture.md](docs/architecture.md) para las reglas de crecimiento del backend.
