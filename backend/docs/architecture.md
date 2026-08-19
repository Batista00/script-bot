# Arquitectura del backend

## Flujo de un módulo comercial

```text
HTTP
  ↓
route
  ↓
controller
  ↓
service
  ↓
repository
  ↓
PostgreSQL
```

- La ruta declara el endpoint y valida el contrato HTTP.
- El controller adapta la petición y la respuesta.
- El service contiene reglas de negocio determinísticas.
- El repository concentra la persistencia y el SQL.
- No se crean todas las capas hasta que el módulo realmente las necesite.

## Integraciones externas

```text
service
  ↓
provider contract
  ↓
adapter concreto
  ↓
API externa
```

Ejemplo conceptual:

```text
OrderService
  ↓
OrderProvider
  ├── SmmRajaProvider
  ├── ProviderB
  └── ProviderC
```

El dominio depende del contrato, no del proveedor concreto. Cambiar una API externa no debe exigir reescribir pedidos, pagos ni otros módulos comerciales.

## Fundación actual

- `config`: lectura y validación de variables de entorno.
- `core/database`: pool compartido de PostgreSQL y cierre ordenado.
- `core/errors`: formato base de errores HTTP.
- `core/logger`: configuración del logger de Fastify.
- `modules/health`: endpoint pequeño de disponibilidad del proceso.
- `modules/businesses`: primera entidad comercial y raíz de propiedad de datos.
- `modules/users`: identidad y credenciales con hash Argon2id.
- `modules/auth`: sesiones opacas, cookie HTTP y guards reutilizables.
- `modules/memberships`: relación entre usuarios y negocios con roles `owner`, `admin` y `operator`.
- `modules/customers`: contactos pertenecientes a un negocio, independientes del canal o proveedor externo.
- `modules/categories`: clasificación business-scoped del catálogo propio.
- `modules/products`: productos y servicios propios del negocio, sin pricing ni referencias a proveedores.
- `modules/pricing`: reglas `fixed` o `unit` business-scoped, con dinero entero y rangos activos no ambiguos.
- `modules/quotes`: snapshots comerciales inmutables del producto y el cálculo de precio ofrecido.
- `modules/orders`: conversión transaccional de Quotes en ventas comprometidas con Items históricos.
- `modules/payments`: intentos de pago business-scoped, idempotencia y aprobación atómica del Order mediante un contrato de provider genérico.
- `modules/integrations`: configuración provider-agnostic por negocio y credenciales cifradas para adapters.
- `integrations/mercado-pago`: adapter Checkout Pro, cliente HTTP nativo, verificación HMAC y webhook público.
- `modules/provider-catalog`: catálogo externo normalizado, sincronización y mappings explícitos hacia Products.
- `modules/fulfillments`: snapshot business-scoped de la entrega por Order Item, dispatch y sincronización de estado mediante un contrato genérico.
- `integrations/smm-raja`: adapters de catálogo y fulfillment, con cliente HTTP form-urlencoded para `services`, `add` y `status`.

```text
Product
  ↓
Pricing
  ↓
Quote
  ↓
Order
  ↓
Payment
  ↓
PaymentProvider
  ↓
Fulfillment
  ↓
ProviderFulfillmentAdapter
```

Los montos monetarios se persisten como enteros `bigint` y solo se exponen dentro del rango entero seguro de la API. Los quotes conservan sus valores históricos; la expiración efectiva se calcula al leer sin producir escrituras inesperadas.

La conversión de un Quote bloquea su fila y crea el Order, su Item y el estado `converted` dentro de una sola transacción. Orders no consulta Pricing ni exige que el Product actual siga activo: utiliza exclusivamente el snapshot comercial aceptado.

Payments copia `amount`, `currency` y customer desde el Order. La llamada al provider ocurre después de confirmar el Payment local y nunca dentro de una transacción PostgreSQL. Una aprobación bloquea Payment y Order, valida que sus snapshots monetarios coincidan y realiza `Payment → approved` junto con `Order: pending_payment → paid` en una sola transacción.

El contrato `PaymentProvider` y su registry pertenecen al dominio Payments. El runtime registra el adapter `mercado_pago`, que obtiene credenciales activas desde Integrations Core y crea una preferencia Checkout Pro fuera de cualquier transacción. Payments Core conserva por separado `provider_reference_id` (la preferencia) y `provider_payment_id` (el pago verificado posteriormente), sin introducir tipos de Mercado Pago en el dominio.

```text
POST Payment
  ↓ commit Payment pending
MercadoPagoPaymentProvider
  ↓ POST /checkout/preferences
provider_reference_id + checkout_url

POST webhook firmado
  ↓ verificar HMAC
GET /v1/payments/:id
  ↓ validar external_reference, Business, provider, amount y currency
PaymentsService.applyVerifiedProviderUpdate
  ↓ transacción
Payment approved + Order paid
```

El webhook identifica la integración por UUID, exige que siga activa y que su provider sea exactamente `mercado_pago`. La notificación recibida solo aporta el identificador a consultar: estado y datos financieros provienen de la consulta server-to-server. Estados externos no soportados se registran como advertencia y no inventan transiciones locales.

Integrations Core separa `config` no secreta de credenciales cifradas con AES-256-GCM. La clave maestra proviene exclusivamente del entorno y el ciphertext se autentica con el contexto Business/provider. Las APIs públicas nunca descifran ni serializan credenciales; el acceso descifrado existe solo como contrato interno para adapters.

## Catálogo de proveedores

```text
Product propio + Pricing propio
            ↓ mapping explícito
ProviderService normalizado
            ↓
BusinessIntegration
            ↓
ProviderCatalogAdapter
            ↓
SmmRajaCatalogAdapter
```

Products y Pricing no dependen del payload externo. `provider_services` conserva la fotografía operativa del proveedor por Business e integración; su `rate NUMERIC` se expone como string decimal y nunca se interpreta como precio retail. `product_provider_mappings` admite un único mapping activo por Product y conserva filas inactivas como historial.

El sync valida primero la integración y resuelve el adapter. La llamada HTTPS ocurre sin una transacción PostgreSQL abierta. Solo después de normalizar completamente el catálogo abre una transacción corta, bloquea la integración activa, realiza upsert y desactiva servicios ausentes. Un payload parcialmente inválido no produce escrituras parciales. La desactivación de un Provider Service no modifica Products, Pricing ni mappings existentes.

## Fulfillment

```text
Order paid
  ↓ lock Order + resolver OrderItem/mapping/provider
Fulfillment pending (snapshot) + commit
  ↓ transacción corta: pending → submitting
ProviderFulfillmentAdapter.createOrder (sin transacción PostgreSQL)
  ↓ confirmación
Fulfillment submitted + Order processing (misma transacción)
  ↓ action=status fuera de transacción
Fulfillment terminal + Order completed/failed (misma transacción)
```

El Core nunca recibe desde HTTP integración, provider service, external service ID ni quantity: deriva esos valores del Order Item y del mapping activo, y conserva el snapshot aunque el mapping cambie. Existe como máximo un Fulfillment por Order Item. El contrato `ProviderFulfillmentAdapter` no conoce credenciales; cada adapter las obtiene internamente desde Integrations Core.

La creación externa no presume exactly-once. Un rechazo explícito deja `failed` y conserva el Order `paid`; un fallo ambiguo después de enviar `action=add` deja `submission_unknown` y bloquea cualquier retry. Las llamadas HTTP siempre ocurren fuera de transacciones. La consulta de estado usa mapping conservador, conserva `provider_status_raw` y no cambia estados locales ante valores externos desconocidos ni ante errores temporales.

## Autenticación y autorización

```text
cookie opaca
  ↓ SHA-256
auth_sessions
  ↓
usuario autenticado
  ↓
business_memberships
  ↓
rol sobre el negocio
```

La contraseña se verifica con Argon2id y nunca sale del módulo de autenticación. El token de sesión solo existe en el cliente; PostgreSQL conserva su hash y vencimiento. Los guards distinguen autenticación, pertenencia al negocio y rol permitido. Crear un negocio y asignar su owner es una operación transaccional.

## Propiedad de datos por negocio

`businesses` es la entidad raíz para separar negocios. Las futuras entidades que pertenezcan a un negocio deberán incluir una referencia `business_id → businesses.id` cuando corresponda. Esta regla no aplica a la propia tabla `businesses`.
