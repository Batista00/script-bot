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
