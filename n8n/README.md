# Workflows n8n de BOT WHATSAP

Workflows **importables** para la instancia de n8n que ya corre en el VPS como servicio aparte.
n8n es la capa de automatizacion y notificacion: consume APIs HTTP que el backend ya expone y
avisa por un webhook generico. **n8n nunca es un backend paralelo.**

Archivos:

| Archivo | Disparador | Que hace |
| --- | --- | --- |
| `alertas-operativas.json` | Schedule cada 5 min | Consulta jobs `failed` y avisa solo por jobs nuevos (dedup por `jobId`). |
| `reporte-diario.json` | Schedule 08:00 | Resume pedidos y pagos recientes y calcula el cobrado del dia. |
| `reconciliacion-manual.json` | Manual (formulario) | Muestra el estado real de una orden/pago y, opcionalmente, dispara el retry de un job. |
| `alertas-fulfillment.json` | Schedule cada 10 min | Avisa fulfillments en `submission_unknown` para revision humana. |

## Importacion

En la UI de n8n: **Workflows → Import from File** y elegir el `.json`. Tambien por CLI de n8n:

```bash
n8n import:workflow --input=/ruta/n8n/alertas-operativas.json
```

Los workflows se importan **inactivos**. Verificarlos y recien despues activarlos.
No se debe modificar, redesplegar ni reinstalar la instancia de n8n del VPS para estos archivos.

## Variables de entorno

Todos los workflows se parametrizan con variables de entorno del proceso de n8n. El JSON no
contiene secretos, tokens, IDs ni URLs de ningun entorno. n8n debe poder leerlas con `$env`
(por defecto `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`; no activar el bloqueo o los workflows fallaran).

| Variable | Uso | Secreta |
| --- | --- | --- |
| `BACKEND_BASE_URL` | URL publica base del backend, sin barra final | No |
| `BUSINESS_ID` | UUID del negocio (multi-negocio) | No |
| `BACKEND_BOT_TOKEN` | Credencial machine-to-machine del backend | **Si** |
| `ALERT_WEBHOOK_URL` | Webhook generico de alertas | **Si** |
| `JOB_ID` | Solo fallback opcional del retry manual; normalmente el job se toma del formulario | No |

Si `ALERT_WEBHOOK_URL` no esta definida, los workflows terminan en un nodo **NoOp** documentado
en vez de enviar el aviso: no hay error y queda registrado en la ejecucion de n8n.

### Credenciales de n8n

Estos workflows **no usan credenciales almacenadas de n8n**: el `Authorization: Bearer` sale de
`{{$env.BACKEND_BOT_TOKEN}}`. Si se prefiere el credencial store de n8n, reemplazar el header por
una credencial **Header Auth** (`Authorization` = `Bearer <token>`) creada en la instancia del VPS,
sin volver a escribir el token en el JSON. Nunca guardar el valor en `pinData`, notas ni en el
workflow versionado.

## Endpoints y permisos

| Workflow | Llamada |
| --- | --- |
| `alertas-operativas` | `GET {{$env.BACKEND_BASE_URL}}/businesses/{{$env.BUSINESS_ID}}/jobs?status=failed&limit=20` |
| `reporte-diario` | `GET .../orders?limit=50` y `GET .../payments?limit=50` |
| `reconciliacion-manual` | `GET .../orders/:orderId`, `GET .../payments/:paymentId`, `POST .../jobs/:jobId/retry` |
| `alertas-fulfillment` | `GET .../fulfillments?status=submission_unknown&limit=20` |

Todas las llamadas usan `Authorization: Bearer {{$env.BACKEND_BOT_TOKEN}}` (Machine Auth) y
`Accept: application/json`. El backend sigue siendo la autoridad: el token debe corresponder a una
credencial con rol owner/admin para el `retry` y owner/admin/operator para las lecturas. n8n no
puede ampliar esos permisos ni saltarlos.

## Reglas de negocio que n8n NO toca

- No duplicar logica de negocio: pricing, estado de pago, estado de orden, fulfillment,
  idempotencia y autorizacion viven en el backend.
- No aprobar pagos, no cambiar estados de orden/pago y no reenviar fulfillments desde n8n.
- No escribir estados ni ningun dato directamente en PostgreSQL, ni usar nodos Postgres,
  Execute Query o SQL. El validador rechaza esos nodos y cualquier sentencia de escritura.
- No guardar secretos ni tokens en el JSON, en `pinData` ni en la documentacion.
- No hardcodear URLs absolutas, IPs, `localhost` ni dominios: todo el trafico al backend pasa
  por `{{$env.BACKEND_BASE_URL}}` y los avisos van a `{{$env.ALERT_WEBHOOK_URL}}`.
- Los totales del reporte se calculan **solo agregando** lo que devuelve el backend (suma de
  `amount` de pagos `approved` del dia). n8n no recalcula precios.
- La reconciliacion manual **solo lee** el estado actual y, si el operador lo pide, delega el
  `retry` al backend. n8n no aprueba pagos ni cambia estados.

## Deduplicacion

Las alertas usan el estado persistente del propio workflow (`$getWorkflowStaticData('global')`)
como Set en memoria de workflow, con retencion de 7 dias, para no repetir el aviso del mismo
`jobId` / fulfillment. Es estado interno de n8n, no de la base del backend. Borrar o recrear el
workflow reinicia ese estado.

## Probar sin tocar produccion

1. Importar el workflow y **dejarlo inactivo**.
2. Definir `ALERT_WEBHOOK_URL` apuntando a un receptor de prueba (por ejemplo un webhook temporal
   propio o `https://webhook.site/...`), nunca al canal real de operaciones.
3. Usar un `BUSINESS_ID` y, si aplica, un `BACKEND_BOT_TOKEN` de un negocio/entorno de prueba.
4. Para los schedules: **Execute Workflow** manual y revisar la pestana de ejecuciones; recien
   despues activar. El disparo programado no cambia hasta activar el workflow.
5. Para `reconciliacion-manual`: ejecutar el formulario con una orden/pago de prueba y dejar
   `dispararRetry = no`; probar `si` solo con un job que se pueda reintentar sin riesgo.
6. Revisar que la ejecucion no escriba nada en el backend: los unicos `POST` posibles son el
   aviso al webhook y el `retry` explicito del formulario.

## Validacion offline

Desde la raiz del repositorio, con Node estandar (sin dependencias):

```bash
node n8n/validate-n8n.mjs
node --test n8n/validate-n8n.test.mjs
```

El validador comprueba: JSON parseable, campos obligatorios del workflow (`name`, `nodes`,
`connections`, `settings`, `pinData`, `versionId`, `meta`, `tags`), nodos con `id`, `name`,
`type`, `typeVersion`, `parameters` y `position`, `connections` que referencian nodos existentes,
ausencia de URLs absolutas/IPs/`localhost`/`pablete.xyz`, ausencia de secretos
(`bw_...`, `Bearer` literal, `sk-...`, `APP_USR-...`, `access_token`/`apiKey` literales),
ausencia de nodos de base de datos o SQL de escritura, y que todo el trafico al backend use
`{{$env.BACKEND_BASE_URL}}` con `Bearer {{$env.BACKEND_BOT_TOKEN}}`.

El modulo no lee archivos ni imprime nada al importarse. Exporta `validateWorkflowDocument(workflow)`,
`validateWorkflowJson(raw)`, `validateWorkflowDirectory(url)` y los chequeos puros por separado.
La lectura, la validacion y el mensaje `n8n workflows valid` solo ocurren al ejecutar el archivo
directamente.

## Notas operativas

- `reporte-diario.json` fija `America/Argentina/Buenos_Aires` en `settings.timezone` para que las
  08:00 sean deterministas; se puede cambiar en la UI de n8n sin editar el JSON.
- Las lecturas piden `limit=50`/`limit=20`; el backend acepta como maximo 100.
- Los avisos usan `neverError` en la respuesta: un webhook caido no rompe la ejecucion ni
  reintenta logicas de negocio.
- `alertas-fulfillment.json` solo notifica `submission_unknown`; la resolucion es manual en el
  panel porque el estado es incierto por definicion.
