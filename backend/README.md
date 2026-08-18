# Backend de BOT WHATSAP

Backend comercial modular con Fastify, configuración validada, PostgreSQL, migraciones versionadas, autenticación por sesión y administración mínima de negocios.

No incluye todavía catálogo, clientes, pedidos, pagos ni proveedores externos.

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

## Autenticación y primer owner

Las sesiones son tokens opacos enviados únicamente en la cookie `bot_whatsap_session`. La base guarda su hash SHA-256, nunca el token original. La cookie es `HttpOnly`, `SameSite=Lax`, usa `Secure` en producción y expira según `AUTH_SESSION_TTL_HOURS`.

Endpoints:

- `POST /auth/login`: recibe `email` y `password`.
- `GET /auth/me`: devuelve el usuario y sus negocios con rol, sin hashes.
- `POST /auth/logout`: invalida la sesión actual y limpia la cookie.

No existe registro público. Después de aplicar las migraciones, crea el primer owner de un negocio existente mediante variables de entorno temporales:

```bash
BOOTSTRAP_BUSINESS_ID="uuid-del-negocio" \
BOOTSTRAP_OWNER_NAME="Nombre Owner" \
BOOTSTRAP_OWNER_EMAIL="owner@example.com" \
BOOTSTRAP_OWNER_PASSWORD="una-clave-segura" \
pnpm bootstrap:owner
```

El script rechaza negocios inexistentes y correos ya registrados, y crea el usuario y su membresía `owner` en una sola transacción. No guardes esos valores reales en `.env` ni en el repositorio.

Todos los endpoints `/businesses` requieren sesión. El listado contiene solo negocios asociados al usuario; consultar uno exige membresía; editarlo exige rol `owner` o `admin`. Al crear un negocio, el usuario autenticado obtiene el rol `owner` dentro de la misma transacción.

## Docker Compose

Después de crear `.env` desde `.env.example` y cambiar sus credenciales de ejemplo:

```bash
docker compose up -d postgres
docker compose run --rm api pnpm migrate
docker compose up -d api
```

Consulta [docs/architecture.md](docs/architecture.md) para las reglas de crecimiento del backend.
