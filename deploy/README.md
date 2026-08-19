# Deployment del backend BOT WHATSAP

Estos artefactos preparan una única instancia del backend y un PostgreSQL 16 exclusivo mediante Docker Compose. No instalan Docker, no despliegan un reverse proxy y no modifican Typebot, Evolution ni servicios existentes.

## Arquitectura preparada

```text
Internet
  ↓ HTTPS
Reverse proxy existente o futuro
  ↓ 127.0.0.1:<puerto inventariado>
backend (puerto interno configurable, normalmente 3000)
  ↓ red bot_whatsapp_backend
backend-postgres:5432
  ↓ volumen bot_whatsapp_postgres_data
```

PostgreSQL no publica ningún puerto al host. La red y el volumen tienen nombres propios para no mezclarse con Typebot o Evolution. La red bridge permite al backend realizar las llamadas HTTPS salientes requeridas por sus adapters.

## Inventario obligatorio de la VPS

Antes de elegir un puerto, una red compartida o un dominio, registrar:

- [ ] sistema operativo y versión;
- [ ] RAM y espacio disponible;
- [ ] versiones de Docker y Docker Compose, o confirmar que no están instalados;
- [ ] containers activos y puertos usados;
- [ ] redes y volúmenes Docker existentes;
- [ ] reverse proxy actual;
- [ ] dominios, DNS y certificados actuales;
- [ ] containers de Typebot y Evolution;
- [ ] instancias PostgreSQL existentes y su propiedad.

Comandos seguros y de solo lectura para ejecutar posteriormente en la VPS:

```bash
uname -a
cat /etc/os-release
free -h
df -h

docker --version
docker compose version
docker ps
docker network ls
docker volume ls

ss -tulpn
```

Si Docker o Compose no existen, detenerse y documentarlo. Esta etapa no autoriza instalaciones, cambios de firewall, DNS, certificados ni detención de servicios.

## Preparar la configuración

Después del inventario:

```bash
cp deploy/.env.production.example deploy/.env.production
chmod 600 deploy/.env.production
```

Generar un password PostgreSQL URL-safe de 32 bytes o más:

```bash
openssl rand -hex 32
```

Alternativa con Node.js:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Colocar el mismo valor en `POSTGRES_PASSWORD` y en el componente password de:

```text
postgresql://POSTGRES_USER:PASSWORD@backend-postgres:5432/bot_whatsapp
```

Generar la clave de cifrado compatible con el backend —exactamente 32 bytes en base64— y guardarla solo en `deploy/.env.production` o en un gestor de secretos del runtime:

```bash
openssl rand -base64 32
```

Alternativa con Node.js:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Completar además:

- `BACKEND_HOST_PORT`: puerto libre confirmado por el inventario;
- `PUBLIC_API_BASE_URL`: origen público final, por ejemplo `https://api.DOMINIO`, siempre HTTPS;
- `DATABASE_URL`: debe usar `backend-postgres`, nunca `localhost` desde el container;
- `PORT`: puerto interno del backend, normalmente `3000`.

No guardar variables `BOOTSTRAP_*`, tokens machine-to-machine, API keys de proveedores ni credenciales reales en Compose o en Git.

## Preflight sin conexiones externas

Validar la plantilla versionada:

```bash
node deploy/scripts/preflight.mjs --example
```

Validar la configuración real antes de usar Compose:

```bash
node deploy/scripts/preflight.mjs
```

También puede elegirse otro archivo explícitamente:

```bash
node deploy/scripts/preflight.mjs --env-file /ruta/segura/backend.env
```

El preflight valida presencia y formato sin imprimir valores secretos. Exige production, PostgreSQL interno, HTTPS público, password fuerte y la clave base64 de 32 bytes.

## Primera construcción y arranque

Solo después del inventario, preflight y revisión de `docker compose config`:

```bash
docker compose \
  --env-file deploy/.env.production \
  -f deploy/docker-compose.backend.yml \
  config

docker compose \
  --env-file deploy/.env.production \
  -f deploy/docker-compose.backend.yml \
  up -d --build
```

El servicio `backend` espera que `backend-postgres` esté saludable, ejecuta directamente el runner instalado de `node-pg-migrate` —equivalente al script `pnpm migrate`— y solo inicia Node si las migraciones terminan correctamente. La invocación directa evita depender de la caché de Corepack después de cambiar al usuario no-root `node`. Esta estrategia presupone exactamente una réplica; no escalar el backend hasta diseñar una coordinación separada de migraciones.

`pnpm bootstrap:owner` no se ejecuta al arrancar. Para la primera instalación, cargar temporalmente sus cuatro variables en la shell administrativa sin escribirlas en el archivo de producción y ejecutar:

```bash
docker compose \
  --env-file deploy/.env.production \
  -f deploy/docker-compose.backend.yml \
  run --rm \
  -e BOOTSTRAP_BUSINESS_NAME \
  -e BOOTSTRAP_OWNER_NAME \
  -e BOOTSTRAP_OWNER_EMAIL \
  -e BOOTSTRAP_OWNER_PASSWORD \
  backend node dist/src/cli/bootstrap-owner.command.js
```

Eliminar esas variables de la shell al terminar. El bootstrap se rechaza si el sistema ya contiene usuarios.

## Health y logs

Compose comprueba `GET /health` desde el propio container usando `fetch` de Node 24, sin instalar curl. Después del reverse proxy, comprobar también:

```bash
curl -fsS https://api.DOMINIO/health
```

El backend escribe logs a stdout/stderr. Inicialmente pueden consultarse con `docker compose logs`; no se añade una plataforma de observabilidad ni límites de recursos rígidos en esta etapa.

## Reverse proxy y HTTPS

El Compose base publica el backend únicamente en `127.0.0.1:BACKEND_HOST_PORT`, opción apropiada para Nginx, Caddy u otro proxy ejecutado en el host. El proxy debe dirigir el origen HTTPS público al puerto loopback seleccionado.

Si el reverse proxy está en Docker —por ejemplo Traefik—, primero inventariar su red. Después se debe crear una configuración de deployment específica que conecte solo `backend` a esa red externa; PostgreSQL debe permanecer únicamente en `bot_whatsapp_backend`. No se presupone ni se crea esa red en este repositorio.

La publicación final no puede ser HTTP-only. Mercado Pago necesita alcanzar:

```text
https://api.DOMINIO/webhooks/mercado-pago/:integrationId
```

Typebot usará posteriormente:

```text
https://api.DOMINIO/bot/v1/*
```

El token de Typebot pertenece al consumidor y no debe estar en el entorno del backend.

## Business API Credential

Después del bootstrap:

```text
login del owner/admin
  ↓
crear Business API Credential por la API administrativa
  ↓
copiar el raw token devuelto una sola vez
  ↓
provisionarlo de forma segura en Typebot
```

No se automatiza este proceso ni se guarda el token en el repositorio.

## Backup y restore

El volumen persistente evita perder datos al recrear un container, pero no es un backup. Guardar dumps fuera del repositorio, con permisos restringidos y copia fuera de la VPS.

Backup inicial en formato custom:

```bash
docker compose \
  --env-file deploy/.env.production \
  -f deploy/docker-compose.backend.yml \
  exec -T backend-postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > /ruta/segura/bot_whatsapp_$(date +%Y%m%d_%H%M%S).dump
```

Para restaurar, abrir una ventana de mantenimiento, verificar el archivo y practicar primero sobre una base separada. Flujo conceptual:

```bash
cat /ruta/segura/backup.dump | docker compose \
  --env-file deploy/.env.production \
  -f deploy/docker-compose.backend.yml \
  exec -T backend-postgres \
  pg_restore -U POSTGRES_USER -d BASE_DESTINO --clean --if-exists
```

`--clean` es destructivo sobre la base destino: confirmar manualmente el destino y tener otro backup verificado antes de usarlo.

## Actualización

Con backup reciente y una sola réplica:

```bash
git pull --ff-only
docker compose --env-file deploy/.env.production -f deploy/docker-compose.backend.yml build backend
docker compose --env-file deploy/.env.production -f deploy/docker-compose.backend.yml up -d backend
curl -fsS https://api.DOMINIO/health
```

El nuevo container aplica migraciones antes de escuchar. Revisar logs y health después de cada actualización. No usar `docker compose down -v`: `-v` elimina el volumen persistente y puede destruir la base de datos.

## Rollback de aplicación

Conservar el commit o tag anterior y el backup previo al update. Si la nueva aplicación falla, volver deliberadamente al código conocido, reconstruir `backend` y comprobar health. No ejecutar `pnpm migrate:down` automáticamente en producción: un rollback de aplicación no implica que una migración destructiva sea reversible.

Si el schema nuevo no es compatible con la versión anterior, detenerse y preparar un plan específico. Restaurar un dump es una operación separada y destructiva que requiere ventana de mantenimiento.

## Límites actuales

- No se ha ejecutado nada en la VPS.
- No se instala ni configura Docker, proxy, DNS, firewall o certificados.
- No se añaden límites rígidos de CPU/RAM; deben definirse después de medir la VPS y la carga.
- No hay backups automáticos, cron, workers, queues, Redis, monitoring, CD ni rollback automático.
- No se configuran credenciales reales de Mercado Pago, SMM Raja, Typebot o Evolution.
