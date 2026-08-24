# SMM Raja — descubrimiento e integración

Comprobación LIVE: **2026-08-23**, entorno local `Flowchat DEV`.

Este documento describe únicamente datos del proveedor. Products, Pricing, Quotes, Orders y
Payments continúan siendo la fuente comercial propia de cada Business.

## Fuentes oficiales

- Documentación: <https://www.smmraja.com/?page=api>
- Ejemplos oficiales: <https://www.smmraja.com/example.txt>
- Endpoint: `POST https://www.smmraja.com/api/v2`
- Content-Type de requests: `application/x-www-form-urlencoded`
- Acciones documentadas: `services`, `balance`, `add`, `status` y consulta de varios estados.

Nunca se guarda la API key en este documento, metadata de servicios, logs ni respuestas del
Admin. La credencial permanece cifrada en `business_integrations`.

## Diagnóstico HTTP LIVE

`action=services` respondió:

- HTTP `200`;
- `Content-Type: application/json; charset=utf-8`;
- sin redirect ni header `Location`;
- JSON válido;
- top-level `array`;
- 3.159.050 bytes;
- 6.311 registros recibidos.

`action=balance` respondió HTTP `200`, JSON object con `balance: string` y
`currency: string`. La moneda observada fue `USD`. El saldo se conserva sólo como información
administrativa y no se expone en contratos comerciales.

El error de autenticación observado con la credencial anterior fue HTTP `401`, JSON object
`{ error: string }`. El mensaje del proveedor no se propaga ni se registra.

## Shape real de services

Los 13 campos siguientes estuvieron presentes en los 6.311 registros:

| Campo | Tipos LIVE | Normalización |
|---|---|---|
| `service` | string | identificador externo operativo; opaco, 5–45 caracteres |
| `serviceID` | string numérico | identificador legado preservado en metadata |
| `name` | string | nombre técnico del proveedor |
| `description` | string | descripción del proveedor separada, máximo observado 3.055 caracteres |
| `category` | string | categoría técnica |
| `type` | string | tipo técnico Raja |
| `rate` | string entero o decimal | costo proveedor, separado de Pricing retail |
| `min` | string o number | límite proveedor; cero se trata como no disponible |
| `max` | string o number | límite proveedor; cero se trata como no disponible |
| `refill` | boolean | metadata segura |
| `cancel` | boolean | metadata segura |
| `subscription` | boolean | metadata segura |
| `extra_parameter` | object | metadata segura |

`extra_parameter` siempre tuvo las claves `drop_rate`, `reliability`, `speed` y `start_time`,
todas string. No se observó ningún `null`. Se observaron 527 categorías distintas, mínimo global
0 y máximo global 2.000.000.000, sin rangos `max < min`.

La sincronización conserva los campos desconocidos seguros en `metadata` JSONB. Claves con
apariencia de secreto se descartan. Nuevos campos del proveedor no invalidan el catálogo.

## Identificadores y error original

### Expected shape anterior

El normalizador anterior exigía que `service` fuese un entero decimal positivo y procesaba el
array completo con semántica todo-o-nada. También rechazaba rate/min cero.

### Actual LIVE shape

Los 6.311 valores `service` fueron identificadores opacos alfanuméricos seguros, no numéricos.
Raja entrega simultáneamente otro campo `serviceID` numérico de 3–4 dígitos, diferente de
`service` en todos los registros. Hubo un `service` duplicado, mientras `serviceID` fue único.

### Root cause

El adapter estaba validando el campo operativo `service` como si fuese el identificador numérico
legado. El primer identificador opaco lanzaba `ProviderResponseInvalidError`; al usar `map` sobre
todo el array, un solo registro abortaba toda la sincronización y el Admin mostraba “El proveedor
devolvió un formato no reconocido”. Los ceros y duplicados podían producir el mismo rechazo
global.

### Fix

- `service` se trata como identificador opaco y se usa para futuros requests `action=add`;
- `serviceID` se preserva en metadata, no reemplaza el ID operativo;
- cero en rate/min/max representa dato no disponible cuando corresponde;
- los registros inválidos se aíslan y cuentan por razón;
- el primer duplicado determinístico se conserva y los demás se reportan;
- la sync LIVE resultó en 6.310 normalizados y 1 rechazo
  (`duplicate_external_service_id`).

## Tipos LIVE y capacidades

| Type LIVE | Registros | Inputs requeridos verificados | Estado adapter |
|---|---:|---|---|
| Default | 5.511 | `targetUrl` → `link`; quantity proviene del OrderItem | soportado |
| Custom Comments | 234 | `targetUrl`, `comments` | soportado |
| Package | 179 | `targetUrl` | soportado |
| Mentions User Followers | 19 | `targetUrl`, `username`; quantity del OrderItem | soportado |
| Comment Likes | 11 | `targetUrl`, `username`; quantity del OrderItem | soportado |
| Subscriptions | 6 | `username`, `minimum`, `maximum`, `posts`, `delay`, `expiry` | soportado |
| Custom Comments Package | 36 | no documentado oficialmente | importable inactivo; despacho bloqueado |
| Invites from Groups | 75 | no documentado oficialmente | importable inactivo; despacho bloqueado |
| Mentions | 6 | no documentado oficialmente | importable inactivo; despacho bloqueado |
| Mentions Custom List | 14 | no documentado oficialmente | importable inactivo; despacho bloqueado |
| Mentions Hashtag | 160 | no documentado oficialmente | importable inactivo; despacho bloqueado |
| Mentions Media Likers | 4 | no documentado oficialmente | importable inactivo; despacho bloqueado |
| Mentions with Hashtags | 23 | no documentado oficialmente | importable inactivo; despacho bloqueado |
| Poll | 9 | no documentado oficialmente | importable inactivo; despacho bloqueado |
| SEO | 20 | no documentado oficialmente | importable inactivo; despacho bloqueado |
| Web Traffic | 4 | no documentado oficialmente | importable inactivo; despacho bloqueado |

La documentación oficial también define `Drip-feed` (`link`, quantity, `runs`, `interval`), pero
ese valor no apareció como `type` LIVE. El adapter conserva su contract test. No se infieren
payloads para nombres parecidos: un tipo sin contrato oficial queda controladamente no soportado.

## Provider capabilities y campos comerciales

`provider_services.order_capabilities` guarda el contrato técnico normalizado. Cada campo tiene
una clave comercial estable, el campo Raja y su tipo. Sólo Provider Catalog/Admin puede ver ese
mapeo.

`products.required_inputs` guarda la presentación comercial editable: clave, label, ayuda,
tipo, required, posición y validación. Ejemplo sanitizado:

```json
[
  {
    "key": "targetUrl",
    "label": "Enlace de destino",
    "helpText": "Ingresa el enlace de la publicación, perfil o recurso.",
    "type": "url",
    "required": true,
    "position": 0,
    "validation": { "maxLength": 10000 }
  }
]
```

El fulfillment valida este contrato comercial y el adapter Raja transforma, por ejemplo,
`targetUrl` a `link`. Canales futuros consumen Product y no necesitan conocer Raja.

## Costo, moneda y precio retail

- Provider rate/cost: USD, propiedad de Provider Service.
- Business `Flowchat DEV`: CLP.
- Product Price: CLP fijado por el dueño.
- Quotes, Orders y Payments usan el snapshot retail CLP.
- La sincronización de un rate Raja nunca modifica Pricing.
- No se implementó conversión FX automática ni sobrescritura de precios.

## Sincronización e importación LIVE

Primera sync con el catálogo actual:

- received 6.311;
- normalized 6.310;
- rejected 1 por ID duplicado;
- created 3;
- updated 6.307;
- reactivated 0;
- inactivated 18 (servicios previamente locales ausentes en el catálogo actual).

Segunda sync inmediata:

- received 6.311;
- normalized 6.310;
- rejected 1;
- created 0;
- updated 6.310;
- reactivated 0;
- inactivated 0.

Se importó de forma atómica un servicio `Default` real como Product local inactivo con SKU
`RAJA-LIVE-20260823`, precio retail CLP 1.990 y un campo comercial `targetUrl`. Después de la
segunda sync permanecieron idénticos Product, descripción, required inputs, Pricing y Mapping.

La importación permite varios Products para un mismo Provider Service: la unicidad sólo impide
más de un mapping activo por Product, no un one-to-one por servicio.

## Balance, status y add

Balance está implementado y se guarda en `provider_catalog_states` con conexión, moneda,
conteos, rechazos y timestamps de sync. Sólo lo consulta el Admin.

Status normaliza `status`, `charge`, `start_count`, `remains` y `currency`. Se conserva
`providerStatusRaw`; un estado desconocido no rompe el proceso ni inventa una transición.

La generación de payload `add` está cubierta por contract tests para Default, Custom Comments,
Mentions User Followers, Package, Drip-feed, Subscriptions y Comment Likes. Los comentarios
normalizan saltos de línea dentro del adapter. **No se ejecutó ninguna acción `add` LIVE ni se
consumió saldo.**

## Limitaciones conocidas

- Raja no publica en las fuentes consultadas el contrato de inputs para diez tipos LIVE; esos
  servicios se conservan e importan inactivos, pero su despacho se bloquea hasta tener evidencia.
- No hubo un provider order ID autorizado para consultar `status` LIVE; se verificó contra el
  shape oficial y contract tests.
- No se usó multi-status porque el flujo actual sincroniza un fulfillment individual.
- Rate/min cero se conservan como no disponibles, no como costo/límite comercial.
