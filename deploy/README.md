# Deployment del backend BOT WHATSAP

Estos artefactos preparan una única instancia del backend y un PostgreSQL 16 exclusivo mediante Docker Compose. No instalan Docker, no despliegan un reverse proxy y no modifican Typebot, Evolution ni servicios existentes.

## Arquitectura preparada

```text
Internet
  ↓ HTTPS
Nginx existente
  ├─ api.pablete.xyz → 127.0.0.1:<puerto inventariado> → backend
  └─ admin.pablete.xyz → admin/dist + /api proxy al backend
                                                        ↓ red bot_whatsapp_backend
                                             backend-postgres:5432
                                                        ↓
                                             bot_whatsapp_postgres_data
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

Comandos seguros y de solo lectura para ejecutar posteriormente en la VPS, antes de cualquier cambio:

```bash
uname -a
cat /etc/os-release
free -h
df -h

docker --version
docker compose version
docker compose ls
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
docker network ls
docker volume ls

ss -tulpn
nginx -v
sudo nginx -T 2>/dev/null | grep -E 'server_name|proxy_pass|listen'
```

Si Docker o Compose no existen, detenerse y documentarlo. No continuar si la huella SSH no coincide con una fuente independiente y confiable; nunca usar `StrictHostKeyChecking=no` para ocultar ese problema. El inventario no autoriza instalaciones, cambios de firewall, DNS, certificados ni detención de servicios.

Con `ss -tulpn`, elegir un puerto TCP libre y documentarlo como `BACKEND_HOST_PORT`. Confirmarlo de nuevo inmediatamente antes del arranque. El bind permanece siempre en `127.0.0.1`; no asumir `3000` ni `3100` como puerto host.

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

`INTEGRATIONS_ENCRYPTION_KEY` es material permanente: respaldarla cifrada en un gestor seguro separado de la VPS y del dump PostgreSQL. Si se pierde, las credenciales de integraciones ya cifradas no podrán recuperarse. No copiar la clave dentro del backup, documentación, logs o repositorio.

Completar además:

- `BACKEND_HOST_PORT`: puerto libre confirmado por el inventario;
- `PUBLIC_API_BASE_URL`: `https://api.pablete.xyz`, siempre HTTPS;
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

## Build y arranque controlado

El script pequeño `deploy/scripts/deploy.sh` ejecuta preflight, valida Compose sin imprimir la configuración resuelta, construye solo el backend, levanta este Compose y espera el health loopback. No modifica Git, Nginx, DNS, TLS, otros proyectos Docker ni volúmenes:

```bash
bash deploy/scripts/deploy.sh
```

Puede recibir una ruta de env distinta como primer argumento. Revisar el script y ejecutar manualmente sus pasos si la política de la VPS no admite scripts. No avanzar a Nginx mientras su healthcheck no termine correctamente.

### Primera construcción y arranque manual

Solo después del inventario, preflight y revisión de `docker compose config`:

```bash
docker compose \
  --env-file deploy/.env.production \
  -f deploy/docker-compose.backend.yml \
  config --quiet

docker compose \
  --env-file deploy/.env.production \
  -f deploy/docker-compose.backend.yml \
  up -d --build
```

El servicio `backend` espera que `backend-postgres` esté saludable, ejecuta directamente el runner instalado de `node-pg-migrate` —equivalente al script `pnpm migrate`— y solo inicia Node si las migraciones terminan correctamente. La invocación directa evita depender de la caché de Corepack después de cambiar al usuario no-root `node`. Esta estrategia presupone exactamente una réplica; no escalar el backend hasta diseñar una coordinación separada de migraciones.

El nombre de proyecto Compose queda declarado en el archivo y las redes/volúmenes tienen nombres exclusivos. No ejecutar desde otro Compose, no usar `docker compose down` como procedimiento de actualización y nunca usar `docker compose down -v`.

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
curl -fsS https://api.pablete.xyz/health
```

El backend escribe logs a stdout/stderr. Inicialmente pueden consultarse con `docker compose logs`; no se añade una plataforma de observabilidad ni límites de recursos rígidos en esta etapa.

## Reverse proxy y HTTPS

El Compose base publica el backend únicamente en `127.0.0.1:BACKEND_HOST_PORT`. Nginx deberá dirigir `api.pablete.xyz` al puerto loopback seleccionado. El puerto no se elige hasta completar el inventario.

Las plantillas auditables están en:

```text
deploy/nginx/api.pablete.xyz.conf.example
deploy/nginx/admin.pablete.xyz.conf.example
```

Copiar cada template a un archivo nuevo según la estructura Nginx inventariada y reemplazar solamente `__BACKEND_HOST_PORT__` y `__ADMIN_DIST_ROOT__`. No editar server blocks de `bot.pablete.xyz`, `evo.pablete.xyz` o `pablete.xyz`. La barra final de `proxy_pass` del Admin elimina `/api/`: `/api/auth/login` llega como `/auth/login`. Es un diseño same-origin para conservar `HttpOnly`, `Secure` y `SameSite=Lax` sin CORS ni `Domain=.pablete.xyz`.

La plantilla Admin incluye fallback SPA, headers de seguridad sencillos, cache largo para `/assets/` hasheados y no-cache para `index.html`. La plantilla API conserva Host, IP real y headers forwarded con timeouts conservadores.

Si el reverse proxy está en Docker —por ejemplo Traefik—, primero inventariar su red. Después se debe crear una configuración de deployment específica que conecte solo `backend` a esa red externa; PostgreSQL debe permanecer únicamente en `bot_whatsapp_backend`. No se presupone ni se crea esa red en este repositorio.

La publicación final no puede ser HTTP-only. Mercado Pago necesita alcanzar:

```text
https://api.pablete.xyz/webhooks/mercado-pago/:integrationId
```

Typebot usará posteriormente:

```text
https://api.pablete.xyz/bot/v1/*
```

El token de Typebot pertenece al consumidor y no debe estar en el entorno del backend.

## DNS y TLS

Verificar públicamente que ambos nombres resuelvan a la IPv4 inventariada de la VPS:

```bash
dig +short A api.pablete.xyz
dig +short A admin.pablete.xyz
```

Si falta alguno, crear mediante el proveedor DNS autorizado `A api → VPS IPv4` y `A admin → VPS IPv4`. Crear AAAA solo si la VPS y Nginx usan IPv6 realmente. No solicitar certificados antes de que DNS resuelva y la configuración HTTP pase `sudo nginx -t`.

Inventariar primero el mecanismo TLS existente (`certbot`, ACME del proveedor u otro) y reutilizarlo. No instalar un segundo cliente automáticamente. Después de colocar los nuevos server blocks:

```bash
sudo nginx -t
# Solo si el comando anterior pasó:
sudo systemctl reload nginx
```

Los comandos concretos para emitir certificados dependen del sistema ya instalado y se deciden después del inventario. Al finalizar, validar `curl -fsS https://api.pablete.xyz/health` y cargar `https://admin.pablete.xyz` sin mixed content.

## Build y publicación del Admin

Construir sin dev server:

```bash
cd admin
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Después del inventario, elegir una ruta estática dedicada —por ejemplo `/var/www/bot-whatsap-admin` solo si encaja con la VPS—, copiar únicamente el contenido de `admin/dist/` y apuntar `__ADMIN_DIST_ROOT__` a ella. No copiar `node_modules`, `.env` ni fuentes como requisito de Nginx.

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

El script usa `pg_dump` del container, formato custom, UTC, permisos restrictivos y un destino obligatorio fuera del repositorio. No lee ni imprime el password:

```bash
BACKUP_DESTINATION=/ruta/protegida/fuera-del-repo \
  bash deploy/scripts/backup-postgres.sh
```

Verificar tamaño, checksum y restauración de prueba. El volumen no reemplaza este backup y todavía no se configura cron.

Para restaurar, abrir una ventana de mantenimiento, verificar el archivo y practicar primero sobre una base separada. Flujo conceptual:

```bash
cat /ruta/segura/backup.dump | docker compose \
  --env-file deploy/.env.production \
  -f deploy/docker-compose.backend.yml \
  exec -T backend-postgres \
  pg_restore -U POSTGRES_USER -d BASE_DESTINO --clean --if-exists
```

`--clean` es destructivo sobre la base destino: confirmar manualmente el destino y tener otro backup verificado antes de usarlo.

## Runbook de primera publicación

1. Verificar acceso SSH y huella del host mediante una fuente independiente.
2. Ejecutar el inventario read-only completo y registrar puerto, Docker, Nginx, disco, RAM, redes y servicios existentes.
3. Verificar/crear DNS A para `api.pablete.xyz` y `admin.pablete.xyz`; esperar propagación.
4. Crear `deploy/.env.production` con permisos `600`, puerto inventariado y secretos nuevos; respaldar la encryption key fuera de la VPS.
5. Ejecutar el preflight real sin mostrar el archivo.
6. Ejecutar `docker compose ... config --quiet` y construir el backend.
7. Levantar este Compose; esperar PostgreSQL healthy y migraciones exitosas.
8. Validar `curl http://127.0.0.1:BACKEND_HOST_PORT/health`; detener el flujo si falla.
9. Ejecutar calidad/build del Admin y publicar solo `admin/dist` en la ruta inventariada.
10. Crear configs Nginx nuevas desde los templates, sin tocar Typebot/Evolution; validar `sudo nginx -t`.
11. Recargar Nginx únicamente después de una validación correcta.
12. Reutilizar el mecanismo TLS existente y validar HTTPS de API y Admin.
13. Si la base está vacía, solicitar los cuatro datos humanos y ejecutar una sola vez el bootstrap manual.
14. Probar login, `/api/auth/me`, Businesses, switcher, dashboard y empty states; crear Machine Credential solo si se autoriza su custodia inmediata.
15. Ejecutar el primer backup, verificarlo y documentar ubicación/checksum fuera del repositorio.

No crear el segundo Business de aislamiento ni datos de prueba en producción sin autorización explícita. No configurar Mercado Pago, SMM Raja ni Typebot sin sus secretos entregados y un procedimiento seguro de custodia.

## Actualización

Con backup reciente y una sola réplica:

```bash
git pull --ff-only
docker compose --env-file deploy/.env.production -f deploy/docker-compose.backend.yml build backend
docker compose --env-file deploy/.env.production -f deploy/docker-compose.backend.yml up -d backend
curl -fsS https://api.pablete.xyz/health
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
- BOT WHATSAP no depende de Ticketz, sus containers, su base de datos ni su disponibilidad. Ticketz puede desaparecer sin afectar esta arquitectura.
- `bot.pablete.xyz` (Typebot) y `evo.pablete.xyz` (Evolution API) permanecen instalaciones aparte; este deployment no las modifica ni las acopla al Panel.
