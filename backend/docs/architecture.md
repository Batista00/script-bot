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
- `modules/api-credentials`: administración humana de credenciales machine-to-machine con token visible una sola vez.
- `modules/machine-auth`: autenticación Bearer independiente y contexto Business derivado del hash del token.
- `modules/bot-gateway`: fachada HTTP v1 con DTOs seguros que reutiliza los servicios comerciales existentes.
- `modules/memberships`: relación entre usuarios y negocios con roles `owner`, `admin` y `operator`.
- `modules/customers`: contactos pertenecientes a un negocio, independientes del canal o proveedor externo.
- `modules/categories`: clasificación business-scoped del catálogo propio.
- `modules/products`: productos y servicios propios del negocio, sin pricing ni referencias a proveedores.
- `modules/pricing`: reglas `fixed` o `unit` business-scoped, con dinero entero y rangos activos no ambiguos.
- `modules/quotes`: snapshots comerciales inmutables del producto y el cálculo de precio ofrecido.
- `modules/orders`: conversión transaccional de Quotes en ventas comprometidas con Items históricos.
- `modules/payment-methods`: opciones de cobro business-scoped y datos no secretos de transferencia bancaria chilena.
- `modules/payments`: intentos de pago business-scoped, idempotencia y aprobación atómica del Order mediante providers o confirmación humana explícita de transferencia.
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

`business_payment_methods` separa la opción comercial que ve el cliente del provider técnico. Una transferencia bancaria crea siempre un Payment `pending`; no ejecuta llamadas externas ni se aprueba sola. Solo la ruta administrativa owner/admin acepta una referencia verificada y reutiliza la transición atómica Payment + Order. El Bot Gateway puede listar y elegir métodos, pero no puede confirmar abonos.

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

Products y Pricing no dependen del payload externo. `provider_services` conserva la fotografía operativa, descripción, metadata segura y `order_capabilities` del proveedor por Business e integración; su `rate NUMERIC` en USD se expone como string decimal y nunca se interpreta como precio retail ni se convierte automáticamente. `products.required_inputs` traduce el contrato técnico a preguntas comerciales multicanal. La importación crea Product, required inputs, Price en `business.currency` y mapping en una transacción. `product_provider_mappings` admite un único mapping activo por Product, no impone one-to-one por Provider Service y conserva filas inactivas como historial.

El sync valida primero la integración y resuelve el adapter. Las llamadas HTTPS de catálogo y balance ocurren sin una transacción PostgreSQL abierta. El adapter rechaza errores top-level, pero aísla registros individuales inválidos y devuelve estadísticas por razón. Después abre una transacción corta, bloquea la integración activa, realiza upsert, desactiva servicios ausentes y actualiza `provider_catalog_states`. La desactivación de un Provider Service no modifica Products, required inputs, Pricing ni mappings existentes.

La importación comercial de un Provider Service es un caso de uso explícito y distinto del
sync. Recibe los datos retail editados por el negocio y, sin efectuar llamadas externas, crea
`Product + ProductPrice + ProductProviderMapping` dentro de una única transacción. Cualquier
error revierte las tres escrituras. El Business se aplica a cada lookup y escritura; el rate
mayorista se muestra como referencia, pero nunca se copia como precio retail implícito.

La eliminación física de Product o Customer sólo se permite cuando PostgreSQL confirma que no existe
historial comercial. Prices y mappings de configuración se eliminan en cascada junto al
Product; una referencia desde Quote, Order Item o Fulfillment produce conflicto y la opción
correcta es desactivar el registro. Los Prices individuales se pueden eliminar porque Quotes y Orders guardan snapshots. Quotes, Orders, Payments y Fulfillments nunca se eliminan
desde la API administrativa.

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

Machine Auth no reutiliza cookies, usuarios ni secrets de providers:

```text
Authorization: Bearer bw_<random>
  ↓ validar formato + SHA-256
business_api_credentials active
  ↓
MachineAuthContext { credentialId, businessId, credentialName }
  ↓
/bot/v1/*
```

El token machine contiene al menos 256 bits aleatorios y solo se devuelve al crearlo; PostgreSQL guarda hash y prefijo. La administración de estas credenciales continúa bajo sesión humana `owner/admin`. Una cookie no autentica el Gateway y un Bearer machine no autoriza rutas administrativas.

Bot Gateway no tiene repositories ni SQL: orquesta Customers, Categories, Products, Pricing, Quotes, Orders, Payments y Fulfillments. Todas las llamadas reciben el `businessId` del `MachineAuthContext`, nunca del cliente. Sus DTOs excluyen provider rates, referencias externas, credenciales, hashes, idempotency keys e inputs sensibles de fulfillment. Las reglas críticas —pago confirmado por provider y dispatch exclusivo desde Order `paid`— permanecen en sus respectivos servicios Core.

## Equipo, membresías y estado del negocio

`business_memberships` une usuarios y negocios con rol `owner|admin|operator` y estado `active|inactive`. El estado permite retirar el acceso sin borrar historial, y `requireBusinessMembership` solo entrega membresías activas: una membresía inactiva se comporta como ausencia de pertenencia (404), y `/auth/me` deja de listar ese negocio.

```text
PATCH  role/status   →  admin no gestiona owners ni concede owner
DELETE membership    →  nunca deja el negocio sin owner activo
POST   membership    →  crea la cuenta si el correo no existe; si existe, la asocia
```

El estado del negocio viaja **denormalizado** dentro de la membership (`businessStatus`) y de la credencial de máquina (`MachineAuthContext.businessStatus`), leídos con un JOIN en la misma consulta que ya hacía cada guard. `requireActiveBusiness()` decide entonces sin I/O y sin aceptar `businessId` del request: un negocio `inactive` responde `409 BUSINESS_INACTIVE` en todo el Bot Gateway y en las mutaciones comerciales, mientras las lecturas, la reconciliación de fulfillments y la administración (negocio, equipo, integraciones, credenciales) siguen disponibles para poder reactivarlo.


## Cola de trabajo y worker

```text
Order paid ──(misma transacción)──> job_queue: order.fulfill
                                          ↓ claim FOR UPDATE SKIP LOCKED
                        Worker ──> ProviderFulfillmentAdapter.createOrder
                                          ↓
                        Fulfillment submitted + Order processing
                                          ↓ job fulfillment.sync (se reprograma)
                        Adapter.getOrderStatus ──> completed | partial | cancelled
                                          ↓
                        Order completed | failed
```

La cola vive en PostgreSQL: un reinicio no pierde trabajo y dos réplicas nunca reclaman la misma fila. Cada job tiene `job_key` única por tipo (idempotencia), `attempts`/`max_attempts`, `run_at` (backoff exponencial), `locked_at`/`locked_by` (lease con recuperación de workers caídos) y `last_error` para diagnóstico. Los sweeps de mantenimiento reabren jobs fallidos **solo** si el trabajo sigue pendiente (pedido pagado sin fulfillment, fulfillment no terminal, pago pendiente con id externo, sesiones vencidas).

El enlace pago → fulfillment es determinístico: la aprobación marca el pedido `paid`, encola el despacho y todo ocurre en una transacción; la llamada externa al proveedor sucede después, en el worker, nunca dentro de una transacción. Un error ambiguo tras enviar el pedido al proveedor deja `submission_unknown` y bloquea el reintento automático.

## Canal WhatsApp

`webhooks/evolution/:integrationId` es la frontera del canal: valida un secreto compartido, normaliza el teléfono y el contenido, resuelve el customer y persiste conversación y mensaje con deduplicación por identificador externo. El backend no conduce la conversación: devuelve contexto al orquestador y ofrece endpoints de lectura y de handoff. Las credenciales de Evolution se resuelven igual que las de cualquier proveedor (integración cifrada + adapter), de modo que añadir otro canal no toca el dominio comercial.

## Propiedad de datos por negocio

`businesses` es la entidad raíz para separar negocios. Las futuras entidades que pertenezcan a un negocio deberán incluir una referencia `business_id → businesses.id` cuando corresponda. Esta regla no aplica a la propia tabla `businesses`.

## Manejo de errores y observabilidad

Todo error de dominio es un `AppError` con `code` estable y status explícito; el handler global responde siempre `{error:{code,message}}` y no filtra detalles internos. Los errores de cliente de Fastify (cuerpo demasiado grande, media type no soportado, validación) conservan su status y se registran como advertencia, no como error interno. Las rutas desconocidas usan el mismo envelope mediante `setNotFoundHandler`.

`GET /health` es liveness y `GET /health/ready` verifica PostgreSQL devolviendo 503 sin exponer la cadena de conexión. Las sesiones vencidas se podan por lotes acotados durante el login, y el login verifica un hash señuelo cuando la cuenta no existe para no revelar por tiempo qué correos están registrados.
