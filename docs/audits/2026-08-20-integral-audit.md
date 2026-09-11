# Auditoría integral BOT WHATSAP — 2026-08-20

> **Nota de vigencia.** Este informe es una fotografía del baseline `3a3b5fb`. El repositorio
> avanzó después y varias afirmaciones ya no aplican:
>
> - Las migraciones 000013 y 000014 se agregaron en `2efb6d8`, por lo que "no se prevé schema
>   nuevo" (más abajo) aplica solo a los cambios evaluados entonces. Hoy existen 15 migraciones.
> - Se agregaron después: rate limiting en `POST /auth/login`, `business.status` efectivo,
>   administración de memberships, `GET /health/ready` y el refactor del validador Typebot.
> - Las cifras de tests listadas (228/242 unit, 14/20 admin) no coinciden con el conteo actual;
>   usar siempre la salida real de `pnpm test` y `pnpm test`.
> - AUD-009 aparece como "resuelto y verificado LIVE" en su sección y como "no verificable" en el
>   cierre; la lectura correcta es que la verificación fue LIVE el 2026-08-23 fuera del alcance
>   local. Las cifras de servicios del proveedor también difieren entre este informe (6.325) y
>   `docs/providers/smm-raja-discovery.md` (6.311 recibidos / 6.310 normalizados); prevalece el
>   documento de descubrimiento.
>
> Hallazgos aún abiertos al cierre de esta nota: AUD-004 (Typebot no completa Fulfillment) y
> AUD-008 (estados de error y selectores del panel).

## Alcance y baseline

Auditoría local, sin SSH, deployment, Docker, datos productivos, pagos reales ni órdenes reales de proveedor. Rama: `codex/auditoria-integral-local` sobre `3a3b5fb`.

Baseline comprobado antes de modificar código:

- Backend: typecheck y build PASS; 228/228 unit tests PASS.
- PostgreSQL 16 local: 9/9 integration tests PASS contra `bot_whatsapp_test`, cargando `backend/.env` sin imprimirlo.
- Admin: lint, typecheck y build PASS; 14/14 tests PASS.
- Typebot: el validador existente informa PASS, aunque no detecta los defectos semánticos confirmados abajo.

## Mapa de arquitectura real

```text
sesión humana → membership/rol → APIs administrativas business-scoped
Machine Credential → businessId resuelto por hash → /bot/v1/*

ProviderIntegration (credenciales AES-256-GCM)
  ↓ adapter externo
ProviderService local (catálogo mayorista)
  ↓ ProductProviderMapping
Product propio → ProductPrice propio → Quote snapshot → Order/Item snapshot
  ↓ PaymentProvider → webhook verificado → Payment approved + Order paid
  ↓ Fulfillment snapshot → ProviderFulfillmentAdapter → Provider Order
```

La separación Provider Service/Product/Pricing está implementada correctamente. El rate externo permanece decimal y no altera pricing retail ni snapshots históricos. Los repositories inspeccionados aplican filtros `business_id`; Machine Auth deriva el Business de la credencial y no acepta `businessId` del bot. Payments y Fulfillments conservan transiciones determinísticas y llamadas externas fuera de transacciones.

## Hallazgos

### AUD-001 — P1 — RESUELTO — Importación atómica de Provider Service

- **Módulo:** Provider Catalog, Products, Pricing, Admin.
- **Síntoma:** Provider Services solo permite sincronizar/listar; el usuario debe crear Product, Price y Mapping en pantallas separadas.
- **Causa raíz:** no existe un use-case ni endpoint de importación.
- **Impacto:** flujo empresarial incompleto y riesgo de Product o Pricing huérfano si se intenta coordinar desde el navegador.
- **Evidencia:** `ProviderServicesPage` no tiene acción de importación; `provider-catalog.routes.ts` solo expone sync y mapping individual.
- **Solución propuesta:** endpoint owner/admin que valide Provider Service e Integration activos y cree Product + Price + Mapping dentro de una única transacción, sin llamada externa.
- **Tests necesarios:** éxito, rollback en Product/Price/Mapping, cross-business, provider/integration inactivos, rol operator rechazado e invalidación UI.

### AUD-002 — P1 — RESUELTO — Contratos semánticos Typebot corregidos

- **Módulo:** Typebot 6.1.
- **Síntoma:** ramas de vacío y mappings del catálogo/order fallan en ejecución; quantity puede evaluarse como literal.
- **Causa raíz:** nueve comparaciones `Equal to` con `value: ""`; veinte paths `data.N.*` y uno `data.items.0.*`; expresión de quantity con `"{{quantityInput}}"` y sin `isCode`.
- **Impacto:** Customer/Product/Quote/Order/Payment pueden caer en rutas de error pese a respuestas válidas.
- **Evidencia:** inspección completa de Conditions, Set variable y Webhook response mappings del JSON.
- **Solución propuesta:** `Is empty` sin valor, índices `data[n]`, expresión code compatible con variables Typebot y reglas estáticas nuevas.
- **Tests necesarios:** el validador debe rechazar cada patrón defectuoso y el template corregido debe pasar.

### AUD-003 — P1 — RESUELTO — Eliminación segura de Product

- **Módulo:** Products y Admin.
- **Síntoma:** solo existe PATCH active/inactive; un Product nuevo no puede eliminarse desde el producto.
- **Causa raíz:** no hay DELETE ni política explícita de conflicto histórico.
- **Impacto:** catálogo operativo acumula errores de configuración; añadir un DELETE ingenuo podría destruir trazabilidad.
- **Evidencia:** ausencia de DELETE en routes/repository/UI. Las FK existentes permiten borrar en cascada Prices/Mappings de un Product sin historia, pero Quotes, Order Items y Fulfillments lo restringen.
- **Solución propuesta:** DELETE owner/admin business-scoped; PostgreSQL decide atomicidad, traduce FK histórica a `409 PRODUCT_HAS_COMMERCIAL_HISTORY` y la UI ofrece desactivar.
- **Tests necesarios:** Product nuevo eliminado, children configuracionales eliminados, historial rechazado, cross-business 404 y operator 403.

### AUD-004 — P1 — CONFIRMADO — Typebot no completa Fulfillment

- **Módulo:** Typebot/Bot Gateway/Fulfillments.
- **Síntoma:** el flujo termina al observar Payment aprobado; no recopila ni envía input de entrega.
- **Causa raíz:** Bot Product DTO no expone un contrato comercial de inputs; los inputs actuales dependen del tipo técnico SMM Raja.
- **Impacto:** el flujo comercial puede completarse manualmente desde Admin, pero no de extremo a extremo desde Typebot.
- **Evidencia:** README y JSON no contienen `/fulfillments`; el validador actualmente lo prohíbe.
- **Solución propuesta:** no filtrar detalles SMM Raja al bot. Diseñar posteriormente un contrato de fulfillment input propio del Product antes de automatizar este paso.
- **Tests necesarios:** contrato genérico business-scoped y dispatch solo después de Payment/Order confirmados.

### AUD-005 — P2 — RESUELTO — Diagnóstico SMM Raja accionable en Admin

- **Módulo:** SMM Raja, Provider Catalog y cliente Admin.
- **Síntoma:** una respuesta provider inválida produce HTTP 502 y el Admin muestra `No fue posible completar la solicitud.`
- **Causa raíz:** `safeMessages` no cubre 502 ni códigos Provider; el cliente descarta status/tipo técnico seguro para diagnóstico.
- **Impacto:** el operador no distingue credencial rechazada, respuesta incompatible y caída temporal.
- **Evidencia:** traducción Backend `PROVIDER_RESPONSE_INVALID`→502 y fallback genérico Admin.
- **Solución propuesta:** mensajes seguros por código, distinguir rechazo explícito del provider y logging estructurado sin body/apiKey.
- **Tests necesarios:** normalización, rechazo explícito, 502/503 accionables y ausencia de secretos.

### AUD-006 — P2 — RESUELTO — Integración local carga `.env`

- **Módulo:** scripts Backend.
- **Síntoma:** `pnpm test:integration` omite tests en Windows aunque `.env` contiene `TEST_DATABASE_URL`; el comando manual con `node --env-file=.env` sí ejecuta 9/9.
- **Causa raíz:** el script invoca `node --test` sin `--env-file-if-exists=.env`.
- **Impacto:** falsa confianza local por tests omitidos y fricción distinta a CI.
- **Solución propuesta:** carga opcional portable; las variables ya inyectadas por CI mantienen precedencia.
- **Tests necesarios:** ejecución local real y CI sin archivo `.env`.

### AUD-007 — P2 — RESUELTO — Validador Typebot cubre los contratos semánticos

- **Módulo:** `validate-typebot.mjs`.
- **Síntoma:** informa `Typebot template valid` para todos los defectos de AUD-002.
- **Causa raíz:** valida referencias/estructura pero no semántica de empty, índices de arrays ni code quantity.
- **Impacto:** CI/local no protegen el template ejecutable.
- **Solución propuesta:** reglas contractuales específicas y pruebas por fixtures mutados en memoria.
- **Tests necesarios:** casos negativos de cada patrón y ausencia de Bearer literal.

### AUD-008 — P3 — CONFIRMADO — Algunos estados error y selectores Admin son débiles

- **Módulo:** Products, Mappings, Provider Services y formularios compartidos.
- **Síntoma:** errores de queries auxiliares pueden parecer listas vacías; selectores limitados a 100 registros no escalan; feedback de error no conserva códigos accionables.
- **Causa raíz:** páginas compactas sin estado error para todas las queries ni búsqueda/paginación de opciones.
- **Impacto:** UX confusa en catálogos grandes, sin corrupción de datos.
- **Solución propuesta:** corregir primero páginas tocadas por import/delete y documentar paginación avanzada como trabajo posterior.
- **Tests necesarios:** query error, permisos e invalidaciones por Business.

### AUD-009 — P1 — RESUELTO Y VERIFICADO LIVE — Formato real de SMM Raja

- **Módulo:** adapter externo.
- **Causa confirmada:** el catálogo real usa IDs opacos alfanuméricos y contiene un ID duplicado conflictivo; además existen valores cero para campos no disponibles.
- **Corrección:** aceptar únicamente IDs opacos seguros, normalizar ceros no disponibles y colapsar duplicados de forma determinística antes de persistir.
- **Verificación:** lectura live sin pedidos y sincronización completa de 6.325 servicios en el Business local; no se registraron secretos ni payloads del catálogo.

### AUD-010 — P0 — NO VERIFICABLE SIN INVENTARIO EXTERNO — Versión desplegada de Typebot

- **Módulo:** instalación Typebot externa, no este template.
- **Evidencia:** advisories oficiales de 2026 indican correcciones de seguridad en Typebot 3.16.0; la versión instalada no se inspecciona por prohibición de SSH/producción.
- **Solución propuesta:** inventariar y actualizar Typebot por un procedimiento separado antes de exponer templates con credenciales.

## Matriz de ciclo de vida

| Entidad | Editar | Desactivar/archivar | Eliminar físicamente | Política y roles |
|---|---|---|---|---|
| Categories | nombre/estado | sí | opcional si se acepta desasignar Products | owner/admin; no borrar historia financiera |
| Products | datos comerciales/estado | sí, opción normal | solo sin Quotes/Orders/Fulfillments | owner/admin; conflicto controlado y sugerir desactivar |
| Product Prices | regla/estado | sí | sí | owner/admin; snapshots protegen Quotes/Orders |
| Customers | contacto/estado | sí | solo sin historia | owner/admin eliminan; con Quotes/Orders se desactiva |
| Integrations | config/credenciales write-only/estado | sí | no | owner/admin; preservar Provider Services/Payments/Fulfillments |
| Provider Services | solo sync externo | sync los activa/inactiva | no | owner/admin sincronizan; operator lee |
| Mappings | cambiar proveedor/estado | sí | no | owner/admin; filas inactivas conservan historia |
| API Credentials | nombre/estado | revocar=inactivar | no | owner/admin; token nunca recuperable |
| Quotes | no recalcular | estado histórico del flujo | no | nunca destruir snapshot |
| Orders | solo transición/cancelación permitida | cancelar pending_payment | no | owner/admin cancelan; sin edición financiera |
| Payments | solo provider verificado | estados terminales | no | sin aprobación ni eliminación manual |
| Fulfillments | dispatch/sync/retry controlado | estados del Core | no | sin eliminación; `submission_unknown` nunca retry |

## Plan de reparación por dependencias

1. Corregir scripts/validadores que hoy producen omisiones o falsos positivos.
2. Mejorar contrato seguro de errores y diagnóstico SMM Raja, sin prueba live ni secretos.
3. Implementar importación atómica Provider Service → Product + Price + Mapping y tests.
4. Implementar lifecycle seguro de Product y tests de historia/roles/Business.
5. Conectar ambas capacidades en Admin con permisos, confirmaciones e invalidación por Business.
6. Corregir el template Typebot y fortalecer su validador.
7. Actualizar arquitectura/README, ejecutar todas las suites reales y documentar E2E externo.

## Decisiones explícitas

- No se modifica ninguna migración 000001–000012; no se prevé schema nuevo para los slices confirmados.
- No se automatiza Fulfillment en Typebot sin un contrato propio del Product: exponer `serviceType` del proveedor rompería la separación arquitectónica.
- No se añade DELETE a Orders, Payments, Fulfillments, Integrations, Credentials o registros históricos.
- No se convierte rate/coste del proveedor en precio retail.
- No se realiza ninguna llamada externa durante la importación transaccional.

## Resultado de reparación y validación

- **Resueltos:** AUD-001, AUD-002, AUD-003, AUD-005, AUD-006 y AUD-007.
- **Documentado como contrato futuro:** AUD-004. No se filtraron detalles técnicos de SMM
  Raja a Typebot para simular un Fulfillment incompleto.
- **Riesgo menor pendiente:** AUD-008 requiere paginación/búsqueda de selectores en una etapa
  posterior; no afecta aislamiento ni integridad.
- **No verificables dentro del alcance local:** AUD-009 (credencial/red live SMM Raja) y
  AUD-010 (versión Typebot desplegada). No se usó SSH ni se accedió a producción.

Validación posterior a la reparación:

- Backend install frozen, typecheck y build: PASS.
- Backend unit tests: 242/242 PASS, 0 skipped.
- PostgreSQL integration tests: 9/9 PASS, 0 skipped, ejecutados serialmente contra la base
  de test configurada; la base de desarrollo no fue limpiada ni usada como fixture.
- Admin lint, typecheck y build: PASS; 20/20 tests PASS.
- Typebot: validador PASS; 4/4 pruebas semánticas PASS.
- `GET /health`: HTTP 200 mediante inyección HTTP sobre la aplicación compilada.

No se modificaron migraciones, Payments Core, Fulfillments Core, secretos, archivos `.env`,
deployment, Docker ni infraestructura externa.
