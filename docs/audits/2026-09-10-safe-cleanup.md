# Auditoría de limpieza segura — 2026-09-10

## Alcance y resultado

Repositorio `Batista00/script-bot`, rama `codex/auditoria-integral-local`.
Base comprobada: `59768034c0069e58b616dc7cf724b2a9aba08381`.
Sin cambios funcionales intencionales, nuevas dependencias, migraciones, prompts,
contratos HTTP, arquitectura ni configuración productiva. No se desplegó a la VPS.

| Métrica | Resultado |
| --- | --- |
| Archivos versionados eliminados | 0; lista exacta: ninguna |
| Archivos existentes modificados | 8 |
| Archivos añadidos | 1: este informe |
| Líneas de código/pruebas eliminadas / añadidas | 21 / 12; reducción neta: 9 |
| Líneas totales eliminadas / añadidas, incluido informe | 21 / 156 (144 añadidas corresponden al informe) |
| Dependencias eliminadas / actualizadas | 0 / 0 |
| Duplicaciones consolidadas | 0 |
| Residuos locales retirados del repositorio | 27 archivos no versionados; 1.073.402 bytes |
| Eliminaciones físicas irreversibles | 0; residuos reubicados con SHA-256 verificado |

## Método y evidencia previa a la limpieza

- Inventario de los 405 archivos versionados, incluyendo archivos ocultos de CI.
- Análisis de referencias/imports y declaraciones de los 341 archivos de código,
  con el parser TypeScript ya instalado; no se añadió ninguna herramienta al proyecto.
- Grafo desde entradas HTTP, SPA, CLI, tests y scripts; los módulos quedan alcanzables.
  `admin/src/vite-env.d.ts` es una declaración ambiental, no un módulo muerto.
- Comprobación adicional con búsquedas de texto en código, tests, documentación,
  Docker, CI, package scripts, generadores y exports. Se revisaron las referencias
  dinámicas por nombre, lectura de JSON y funciones serializadas de los builders.
- `tsc --noEmit --noUnusedLocals --noUnusedParameters` detectó siete casos en backend;
  después de la limpieza termina sin errores. El mismo control del admin también pasa.
- Inspección de dependencias de backend/admin: imports, tipos ambientales, CLI,
  configuración de ESLint/Vite/Vitest, scripts, migraciones y runtime de Docker.
- Revisión de comentarios de código y cuerpos de funciones literalmente duplicados.
  Las búsquedas estáticas no se usan como prueba de que una integración externa no exista.

## A. Eliminado con evidencia

| Archivo | Limpieza y evidencia |
| --- | --- |
| `backend/src/modules/fulfillments/fulfillments.service.ts` | Import sin uso de `ProviderSubmissionUnknownError` (TS6133); se conserva la clase, el manejo de errores y sus pruebas. |
| `backend/src/modules/sales/sales.repository.ts` | Import de tipo `SalesState` sin uso (TS6196); ninguna consulta SQL modificada. |
| `backend/tests/auth.test.ts` | Import de tipo `preHandlerHookHandler` sin uso (TS6133). |
| `backend/tests/payments.test.ts` | Import de `PaymentsService` sin uso (TS6133); los tests siguen usando el factory existente. |
| `backend/tests/support/fulfillments-memory.ts` | Import de tipo `DatabaseExecutor` sin uso (TS6196). |
| `backend/tests/fulfillments.test.ts` | Binding `submitted` sin lectura (TS6133); se conserva `await first`, el orden y todas las aserciones. |
| `backend/src/modules/sales/sales-conversation.service.ts` | Parámetro privado `catalog(..., settings, ...)` nunca leído (TS6133); retirado en las ocho llamadas, conservando `heading`. No se cambia el cuerpo de búsqueda, presentación o transición. |
| `backend/src/modules/bot-gateway/bot-gateway.types.ts` | Interface `BotPaymentMethodDto` sin consumidores: la única referencia era su declaración. `listPaymentMethods` utiliza su retorno inferido y el schema HTTP permanece intacto. No es un paquete público publicado. |

No se eliminan tests, endpoints, clases comerciales, funciones de negocio ni archivos completos.

## B. Conservado

- Los 20 archivos de migración, CI, Docker, compose, scripts de despliegue/backup,
  ejemplos de entorno, lockfiles y documentación operativa: entradas y recuperación existentes.
- Backend y panel, todos sus dominios, autenticación, aislamiento por negocio,
  cifrado, inbox/outbox e idempotencia: módulos activos o contratos de integración.
- `ai-orchestrator`, Bot Gateway y sus rutas: siguen registrados en `app.ts`;
  no se deduce obsolescencia a partir del flujo Typebot actual.
- `flows/scripts/**`, los cinco exports n8n y el export Typebot 6.1: generación e importación.
  Regenerarlos no produce diferencias; los prompts no se modifican.
- `typebot/**`, incluido `bot-whatsap-ai-commerce-v1.before-prices.json`:
  referencia histórica explícita en README y cobertura de importables.
- `datos/**`, documentación y laboratorios: antecedentes y recuperación; no código runtime prescindible.
- `vite-env.d.ts` y los métodos React `getDerivedStateFromError`/`componentDidCatch`:
  consumidos por TypeScript/React sin una llamada explícita en el proyecto.
- Todas las dependencias: `node-pg-migrate` se usa en CLI, integración y runtime;
  `tsx`/TypeScript en desarrollo/build; `@types/*` en resolución de tipos; `jsdom`
  en Vitest; ESLint, Vite y sus plugins en configuración/scripts; el resto en imports.
- Duplicaciones cortas de paginación, errores SKU y helpers de tests: consolidarlas
  introduciría acoplamiento o una abstracción sin beneficio suficiente. Cero consolidaciones.
- `.env`, dependencias instaladas y salidas de build ignoradas: necesarios para
  desarrollo local; no se incluyen en Git ni se presentan como archivos fuente sobrantes.

## C. Dudoso / no eliminado

- `PaymentMethodsService.getActiveById`: no se encontraron llamadas estáticas,
  pero es un método público del dominio de pagos. Se conserva por la restricción
  explícita sobre pagos y por no poder descartar consumidores operativos externos.
- Retirada definitiva de plantillas/laboratorios históricos: no se puede demostrar
  que no sirvan para recuperación fuera del repositorio. Se conservan.
- Los helpers y archivos locales de despliegue no tienen referencias en los archivos
  versionados, pero pueden servir para recuperación. Se reubican, no se destruyen.

## Residuos locales recuperables: lista exacta

Destino fuera del repositorio: carpeta hermana
`../script-bot-cleanup-residue-20260910-5976803/`.
Se validaron rutas antes de mover y hashes SHA-256 de los 27 archivos antes/después.
No se ejecutó ningún helper de despliegue ni se subieron estos archivos a GitHub.

```text
.codex-catalog-followups.bundle
.codex-catalog-prepare.bundle
.codex-categories-update.tar.gz
.codex-category-typebot.cjs
.codex-commerce-update.tar.gz
.codex-commit-8d1e968.bundle
.codex-idle-session-fix.tar.gz
.codex-inspect-n8n.cjs
.codex-merge-bw03-live.cjs
.codex-merge-bw03.cjs
.codex-native-typebot.tar
.codex-receipt-before.tar.gz
.codex-receipt-update.tar.gz
.codex-reply-lifecycle-fix.tar.gz
.codex-sales-path-fix.tar
.codex-receipt-baseline/backend/README.md
.codex-receipt-baseline/backend/src/modules/automation/automation.service.ts
.codex-receipt-baseline/backend/src/modules/payment-reviews/payment-reviews.repository.ts
.codex-receipt-baseline/backend/src/modules/payment-reviews/payment-reviews.service.ts
.codex-receipt-baseline/backend/src/modules/sales/sales-checkout.service.ts
.codex-receipt-baseline/backend/src/modules/sales/sales-context.ts
.codex-receipt-baseline/backend/src/modules/sales/sales-conversation.service.ts
.codex-receipt-baseline/backend/src/modules/sales/sales.plugin.ts
.codex-receipt-baseline/backend/src/modules/sales/sales.repository.ts
.codex-receipt-baseline/backend/tests/sales-automation.test.ts
.codex-receipt-baseline/backend/tests/helpers/sales-fixture.ts
.codex-receipt-baseline/backend/tests/integration/sales-automation.integration.test.ts
```

## Verificación

| Comando / ámbito | Resultado |
| --- | --- |
| Backend: `pnpm install --frozen-lockfile` | OK, sin cambios de paquetes ni lockfile |
| Backend: `pnpm typecheck` y `pnpm build` | OK |
| Backend: `pnpm test` | 280 unitarios + 31 ventas + 40 integración = 351; cero fallos/omitidos |
| Base de integración | Exclusivamente `127.0.0.1/bot_whatsapp_test`, verificada antes de ejecutar |
| Admin: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` | Todo OK; 12 archivos de test, 41 pruebas aprobadas |
| `node flows/scripts/generate.mjs` | OK; `git diff --exit-code -- flows/n8n flows/typebot` sin diferencias |
| Las tres suites de `flows/tests/*.test.mjs` | 36 aprobadas |
| Las dos suites de `typebot/*.test.mjs` | 7 aprobadas; validador semántico OK |
| Controles adicionales de TypeScript sin locals/parámetros sin uso | Backend y admin OK |
| `git diff --check` | OK |

La regresión `Instagram → Seguidores → Precios`, los precios actuales de PostgreSQL,
las FAQ/saludos, la herramienta catalog y la idempotencia siguen pasando.
Las pruebas no sustituyen una nueva E2E por WhatsApp: esta tarea no toca producción.

El commit incluye únicamente los ocho cambios revisados y este informe; no incluye
secretos, backups, bundles, archivos de entorno ni utilidades temporales de auditoría.
