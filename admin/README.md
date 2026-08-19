# Panel administrativo BOT WHATSAP

SPA administrativa React + TypeScript + Vite para las APIs humanas del backend. No usa Bot Gateway ni Machine Auth y no contiene tienda, checkout web o storefront.

## Arquitectura y seguridad

El panel autentica mediante `POST /auth/login`, restaura la sesión con `GET /auth/me` y la cierra con `POST /auth/logout`. Todos los requests pasan por `src/lib/api/client.ts`, usan `credentials: same-origin` y tienen `/api` como base predeterminada. La cookie de sesión permanece HttpOnly: no se almacena password, sesión, token machine ni secreto de proveedor en localStorage, sessionStorage, IndexedDB, URLs o una cache persistente.

En producción, Nginx servirá `dist/` y enviará `/api/*` al backend eliminando únicamente `/api`. No se necesita CORS. En desarrollo, Vite reproduce ese proxy hacia `http://127.0.0.1:3000`.

Las credenciales de integración son write-only. Los responses públicos no contienen secretos; el formulario se desmonta después de guardar o cerrar. Un raw API Credential se muestra en un diálogo una sola vez y se elimina del estado al cerrarlo.

## Multi-business y roles

`GET /auth/me` entrega los Businesses accesibles y el rol `owner`, `admin` u `operator`. Las rutas usan `/businesses/:businessId/...`; el guard comprueba que el ID esté entre los Businesses del usuario y el backend vuelve a autorizar cada request mediante membership.

Todas las query keys de datos propios incluyen `businessId`. El Business Switcher remueve de memoria las queries del contexto anterior antes de navegar al nuevo ID. La interfaz oculta acciones incompatibles con el rol, pero esto es solo UX: el backend es la autoridad de seguridad.

No existe API HTTP de administración de memberships/invitaciones, por lo que no se creó una pantalla falsa de equipo. Queda pendiente para una etapa futura.

## Módulos

- Dashboard con filas recientes reales, sin presentar conteos parciales como totales.
- Businesses, Customers, Categories, Products y Pricing.
- Quotes, Orders y Payments sin recálculo ni aprobación manual.
- Fulfillments con listado global seguro, dispatch, sync y retry conservador.
- Provider Services, sync vía backend y Product Provider Mappings.
- Integrations genéricas, con formularios especializados para `mercado_pago` y `smm_raja`.
- API Credentials y Business Settings.

Las tablas operativas usan `limit`/`offset` y navegación Anterior/Siguiente porque las APIs no entregan un total. El dashboard carga ventanas recientes y lo indica expresamente.

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
