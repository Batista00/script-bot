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
- `modules/integrations`: configuración provider-agnostic por negocio y credenciales cifradas para futuros adapters.

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
```

Los montos monetarios se persisten como enteros `bigint` y solo se exponen dentro del rango entero seguro de la API. Los quotes conservan sus valores históricos; la expiración efectiva se calcula al leer sin producir escrituras inesperadas.

La conversión de un Quote bloquea su fila y crea el Order, su Item y el estado `converted` dentro de una sola transacción. Orders no consulta Pricing ni exige que el Product actual siga activo: utiliza exclusivamente el snapshot comercial aceptado.

Payments copia `amount`, `currency` y customer desde el Order. La llamada al provider ocurre después de confirmar el Payment local y nunca dentro de una transacción PostgreSQL. Una aprobación bloquea Payment y Order, valida que sus snapshots monetarios coincidan y realiza `Payment → approved` junto con `Order: pending_payment → paid` en una sola transacción.

El contrato `PaymentProvider` y su registry pertenecen al dominio Payments; el runtime no registra todavía ningún adaptador real. Mercado Pago, sus webhooks y cualquier otro proveedor externo se implementarán posteriormente sin introducir detalles del proveedor en Orders o Payments Core.

Integrations Core separa `config` no secreta de credenciales cifradas con AES-256-GCM. La clave maestra proviene exclusivamente del entorno y el ciphertext se autentica con el contexto Business/provider. Las APIs públicas nunca descifran ni serializan credenciales; el acceso descifrado existe solo como contrato interno para adapters futuros.

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
