# Panel administrativo BOT WHATSAP

SPA administrativa React + TypeScript + Vite para las APIs humanas del backend. No usa Bot Gateway ni Machine Auth y no contiene tienda, checkout web o storefront.

## Arquitectura y seguridad

El panel autentica mediante `POST /auth/login`, restaura la sesión con `GET /auth/me` y la cierra con `POST /auth/logout`. Todos los requests pasan por `src/lib/api/client.ts`, usan `credentials: same-origin` y tienen `/api` como base predeterminada. La cookie de sesión permanece HttpOnly: no se almacena password, sesión, token machine ni secreto de proveedor en localStorage, sessionStorage, IndexedDB, URLs o una cache persistente.

En producción, Nginx servirá `dist/` y enviará `/api/*` al backend eliminando únicamente `/api`. No se necesita CORS. En desarrollo, Vite reproduce ese proxy hacia `http://127.0.0.1:3000`.

Las credenciales de integración son write-only. Los responses públicos no contienen secretos; el formulario se desmonta después de guardar o cerrar. Un raw API Credential se muestra en un diálogo una sola vez y se elimina del estado al cerrarlo.

## Multi-business y roles

`GET /auth/me` entrega los Businesses accesibles y el rol `owner`, `admin` u `operator`. Las rutas usan `/businesses/:businessId/...`; el guard comprueba que el ID esté entre los Businesses del usuario y el backend vuelve a autorizar cada request mediante membership.

Todas las query keys de datos propios incluyen `businessId`. El Business Switcher remueve de memoria las queries del contexto anterior antes de navegar al nuevo ID. La interfaz oculta acciones incompatibles con el rol, pero esto es solo UX: el backend es la autoridad de seguridad.

La pantalla **Equipo** administra las membresías del negocio contra `/businesses/:businessId/memberships`: listar miembros, invitar (creando la cuenta cuando el correo no existe o asociando la existente), cambiar rol, activar/desactivar acceso y retirar la membresía. Solo `owner` y `admin` la usan; `operator` ve un aviso y no consulta el endpoint. La interfaz replica las reglas del backend antes de enviar (un admin no gestiona owners ni concede `owner`, un admin no edita su propia fila, y el último owner activo no se degrada), pero el backend sigue siendo la autoridad.

## Módulos

- Dashboard con filas recientes reales, sin presentar conteos parciales como totales.
- Businesses, Customers, Categories, Products, Pricing y Team (membresías y roles).
- Quotes, Orders y Payments sin recálculo ni aprobación manual; una cotización `active` puede
  convertirse en pedido desde la propia tabla.
- Fulfillments con listado global seguro, dispatch, sync y retry conservador.
- Provider Services con conexión/saldo, búsqueda y filtros paginados, capacidades de pedido,
  conteo de Products, sync vía backend e importación atómica y editable de
  Product + required inputs + Pricing + Mapping.
- Integrations genéricas, con formularios especializados para `mercado_pago` y `smm_raja`.
- API Credentials y Business Settings.

Cuando el negocio activo está `inactive`, aparece una banda de aviso: las operaciones comerciales están bloqueadas y solo queda la administración para reactivarlo. El cliente traduce el `429 TOO_MANY_LOGIN_ATTEMPTS` del rate limiting y los códigos `BUSINESS_INACTIVE`, `LAST_OWNER_REQUIRED`, `MEMBERSHIP_*` y `USER_*` a mensajes accionables en español.

Las tablas operativas usan `limit`/`offset` y navegación Anterior/Siguiente porque las APIs no entregan un total. El dashboard carga ventanas recientes y lo indica expresamente.

Products y Customers permiten eliminación física sólo cuando el backend confirma que no existe historial
comercial; ante conflicto la interfaz indica desactivar. Customers, Prices, Integrations,
Provider Services, mappings y credenciales conservan su ciclo de desactivación o revocación.
Quotes, Orders, Payments y Fulfillments son históricos y no ofrecen eliminación.

La moneda global se edita en Configuración y se reutiliza en Pricing, importación de servicios y Quotes. Métodos de pago permite configurar Mercado Pago o transferencia chilena (RUT, titular, banco, tipo y número de cuenta, correo opcional). Las transferencias quedan pendientes hasta confirmación humana por owner/admin.

**Catálogo de proveedores** muestra la referencia técnica, el costo mayorista y las métricas operativas sincronizadas, pero la importación siempre crea un producto y un precio retail propios del negocio. Un mismo servicio externo puede originar varios paquetes comerciales de forma explícita. Los productos sin vínculo externo continúan disponibles para ventas y entregas manuales.

**Ventas por WhatsApp** reúne estado del canal, Telegram, conversaciones derivadas y pedidos en seguimiento. El prompt principal no se edita en esta pantalla: vive en Typebot. El panel conserva solamente respuestas de respaldo y controles determinísticos del backend. Cuando una persona toma una conversación, puede registrar el resultado de la gestión y decidir explícitamente si reanuda el bot.

## Desarrollo

Requiere Node.js 24 y pnpm 11.19.0.

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm dev
```

El backend debe escuchar en `127.0.0.1:3000`. `VITE_API_BASE_PATH` puede cambiar el prefijo público, pero su default correcto es `/api`. Las variables `VITE_*` son visibles en el navegador: nunca colocar en ellas tokens ni passwords.

## Calidad y build

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`dist/` es un artefacto estático. Los tests cubren cliente/login, errores seguros, selector y cache por Business, permisos, ciclo de vida del raw token y no persistencia de secretos.

## Deployment conceptual

Dominio previsto: `https://admin.pablete.xyz`. Nginx deberá servir `admin/dist`, aplicar fallback SPA a `index.html` y proxificar `/api/` al loopback del backend eliminando el prefijo. Las plantillas versionadas están en `deploy/nginx/`; requieren reemplazar el puerto y la ruta con valores inventariados, validar `nginx -t` y reutilizar el mecanismo TLS existente. El repositorio no contiene secretos productivos.
