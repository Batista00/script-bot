# BOT WHATSAP

Backend comercial multi-negocio, panel administrativo y flujo conversacional para vender servicios digitales por WhatsApp, cobrar con Mercado Pago o transferencia bancaria y entregar mediante proveedores externos (SMM Raja).

## Estructura

| Directorio | Contenido |
|---|---|
| `backend/` | API Fastify + PostgreSQL, migraciones, tests unitarios y de integración |
| `admin/` | SPA administrativa React + Vite para las APIs humanas |
| `typebot/` | Template de flujo Typebot 6.1 y su validador offline |
| `deploy/` | Compose de producción, plantillas Nginx, scripts de despliegue y backup |
| `docs/` | Arquitectura, auditorías y descubrimiento de proveedores |
| `datos/` | Documentación histórica de planificación (no describe el estado actual) |

Cada aplicación es independiente: no hay workspace raíz. `backend/` y `admin/` tienen su propio `package.json` y `pnpm-lock.yaml`.

## Arquitectura en una vista

```text
WhatsApp → Typebot → Bot Gateway (/bot/v1, Bearer bw_...)
                              ↓
Panel admin (/businesses/:id/..., cookie de sesión)
                              ↓
Customers → Categories/Products → Pricing → Quotes → Orders
                                                       ↓
                              Payments (Mercado Pago | transferencia)
                                                       ↓
                              Fulfillments → SMM Raja
```

Reglas de crecimiento y convenciones de capas: [`AGENTS.md`](AGENTS.md).
Arquitectura detallada: [`backend/docs/architecture.md`](backend/docs/architecture.md).

## Requisitos

- Node.js 24 (el backend declara 22+, CI y Docker usan 24) y pnpm 11.19.0 (Corepack).
- PostgreSQL 16.

## Puesta en marcha local

```bash
# 1. Base de datos
docker compose -f backend/docker-compose.yml up -d postgres

# 2. Backend
cd backend
cp .env.example .env
pnpm install --frozen-lockfile
pnpm migrate
pnpm dev                     # http://localhost:3000/health

# 3. Primer negocio y owner (una sola vez, sin guardar los valores)
BOOTSTRAP_BUSINESS_NAME="Mi negocio" \
BOOTSTRAP_OWNER_NAME="Owner" \
BOOTSTRAP_OWNER_EMAIL="owner@example.com" \
BOOTSTRAP_OWNER_PASSWORD="una-clave-larga" \
pnpm bootstrap:owner
```

```bash
# 4. Panel administrativo
cd admin
cp .env.example .env
pnpm install --frozen-lockfile
pnpm dev                     # proxy /api → 127.0.0.1:3000
```

## Tests

```bash
cd backend
pnpm typecheck
pnpm build
pnpm test                    # unit + integración (los 11 de integración se omiten sin TEST_DATABASE_URL)

TEST_DATABASE_URL="postgresql://usuario:clave@127.0.0.1:5432/bot_whatsapp_test" pnpm test:integration
```

```bash
cd admin
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

```bash
# Template Typebot (solo Node estándar)
node typebot/validate-typebot.mjs
node --test typebot/validate-typebot.test.mjs
```

Los tests de integración crean su propio esquema con las migraciones y limpian los negocios que generan. Nunca apuntes `TEST_DATABASE_URL` a una base productiva.

## Seguridad operativa

- Los secretos viven solo en variables de entorno; no hay valores por defecto ni credenciales en el repositorio.
- Las credenciales de integraciones se cifran con AES-256-GCM usando `INTEGRATIONS_ENCRYPTION_KEY` (32 bytes base64). Si se pierde, las credenciales cifradas no se recuperan.
- La API humana usa cookie `HttpOnly`; el Bot Gateway usa credenciales `bw_...` administradas por owner/admin.
- `POST /auth/login` tiene rate limiting por IP; `GET /health/ready` verifica PostgreSQL.
- Un negocio con `status = inactive` queda bloqueado para operaciones comerciales y conserva la administración.

Guía de despliegue: [`deploy/README.md`](deploy/README.md).

## Estado del proyecto

El repositorio está preparado para operación real de un negocio (o varios) con un único proceso backend, con las siguientes limitaciones conocidas:

- No hay registro público ni invitaciones por correo: los usuarios se crean desde el panel (Equipo) o con `pnpm bootstrap:owner`.
- No hay workers, colas ni polling: el despacho de fulfillments es explícito y el webhook de Mercado Pago es la única confirmación automática.
- No hay CD: el despliegue es manual y está documentado en `deploy/README.md`.
- Typebot no completa el paso de fulfillment; ver `typebot/README.md`.
