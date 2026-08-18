# BOT WHATSAP — Resumen técnico del proyecto

**Fecha:** 2026-08-17  
**Proyecto:** BOT WHATSAP  
**Objetivo:** construir un sistema comercial automatizado por WhatsApp usando **Evolution API + Typebot 6.1 + OpenAI**, con integración futura a **SMM Raja, Mercado Pago, PostgreSQL y Telegram**.

---

## 1. Objetivo general

El sistema debe permitir que un cliente converse por WhatsApp de forma natural, sea atendido por IA, elija o solicite servicios, reciba precios, pague y finalmente se genere el pedido automáticamente.

Arquitectura objetivo:

```text
WhatsApp
   ↓
Evolution API
   ↓
Typebot 6.1
   ↓
OpenAI / lógica conversacional
   ↓
Catálogo / servicios / cantidades / precios
   ↓
Pago
   ↓
Verificación determinística
   ↓
SMM Raja API
   ↓
Creación del pedido
   ↓
Estado / soporte / notificaciones
```

La IA se utilizará para conversación natural, clasificación de intención, extracción de datos y eventualmente visión para comprobantes.

La lógica crítica —pagos, pedidos, validaciones, estados y persistencia— debe ser determinística y no depender únicamente de la IA.

---

## 2. Arquitectura acordada

### WhatsApp
Canal de entrada y salida del cliente.

### Evolution API
Puente entre WhatsApp y Typebot.

Versión validada:

```text
Evolution API 2.3.4
```

### Typebot
Versión/esquema validado:

```text
Typebot 6.1
```

Se utilizará para flujo conversacional, variables, decisiones, llamadas HTTP, integración OpenAI, rutas, recolección de datos e interacción con backend.

### OpenAI
Se utilizará para conversación natural, detección de intención, extracción estructurada, clasificación de plataforma/servicio/cantidad y eventualmente visión.

Modelo utilizado en los laboratorios:

```text
gpt-5.4-nano
```

### SMM Raja
Proveedor previsto:

```text
https://www.smmraja.com/api-key
```

Se utilizará para consultar servicios, crear pedidos y consultar estados.

### Mercado Pago
Se utilizará para crear y verificar pagos. La lógica de pago no debe depender de lo que declare el cliente.

### Telegram
Canal administrativo para aprobaciones manuales, especialmente transferencias.

Flujo previsto:

```text
Cliente envía comprobante por WhatsApp
↓
Evolution recibe la imagen
↓
IA puede analizarla de forma transitoria
↓
Se extraen datos estructurados
↓
Telegram recibe SOLO datos de texto
↓
Administrador confirma o rechaza
```

El comprobante no debe almacenarse innecesariamente en Typebot.

### PostgreSQL
Base recomendada para la lógica comercial.

Tablas mínimas conceptuales:

```text
customers
orders
payments
```

La base de datos será la fuente de verdad del sistema comercial.

---

## 3. Infraestructura actual del VPS

Contenedores detectados:

```text
typebot-typebot-viewer-1         baptistearno/typebot-viewer:latest
typebot-typebot-builder-1        baptistearno/typebot-builder:latest
typebot-typebot-db-1             postgres:16

evolution-evolution-api-1        evoapicloud/evolution-api:v2.3.4
evolution-postgres-1             postgres:16
evolution-redis-1                redis:alpine

ticketz-docker-acme-frontend-1   ghcr.io/ticketz-oss/ticketz-frontend:latest
ticketz-acme-companion           nginxproxy/acme-companion
ticketz-docker-acme-backend-1    ghcr.io/ticketz-oss/ticketz-backend:latest
ticketz-docker-acme-postgres-1   postgres:16-alpine
ticketz-docker-acme-redis-1      redis:7-alpine
ticketz-nginx-proxy              nginxproxy/nginx-proxy
```

Ticketz ya existía en el mismo VPS y utiliza su propio sistema nginx/docker.

---

## 4. Typebot instalado

Directorio:

```text
/root/typebot
```

Compose:

```text
/root/typebot/docker-compose.yml
```

Puertos locales:

```text
Builder → 127.0.0.1:3001 → container 3000
Viewer  → 127.0.0.1:3002 → container 3000
```

Variables detectadas:

```text
NEXTAUTH_URL=https://bot.pablete.xyz
NEXT_PUBLIC_VIEWER_URL=https://bot.pablete.xyz/bot
```

URL pública:

```text
https://bot.pablete.xyz
```

Viewer público:

```text
https://bot.pablete.xyz/bot/<public-id>
```

---

## 5. Evolution API instalada

Directorio:

```text
/root/evolution
```

Compose:

```text
/root/evolution/docker-compose.yml
```

Evolution escucha localmente en:

```text
127.0.0.1:8080
```

Dominio público:

```text
https://evo.pablete.xyz
```

Instancia utilizada en pruebas:

```text
yo
```

---

## 6. Habilitación de Typebot dentro de Evolution

Inicialmente Evolution tenía Typebot deshabilitado.

Se validó que Evolution 2.3.4 usa:

```text
TYPEBOT_ENABLED
TYPEBOT_API_VERSION
TYPEBOT_SEND_MEDIA_BASE64
```

Se agregó al servicio `evolution-api`:

```yaml
TYPEBOT_ENABLED: "true"
TYPEBOT_API_VERSION: "latest"
```

Se validó el compose con:

```bash
docker compose config >/dev/null && echo "COMPOSE OK"
```

Después se recreó el contenedor de Evolution.

---

## 7. Incidente 502 después de recrear Evolution

Después de recrear el contenedor, el dominio:

```text
https://evo.pablete.xyz/manager
```

mostró:

```text
502 Bad Gateway
```

Evolution estaba funcionando internamente:

```bash
curl -i http://127.0.0.1:8080/
```

respondía HTTP 200.

Se descubrió que Evolution había perdido una conexión manual a la red del nginx de Ticketz.

Red Evolution:

```text
evolution_default
```

Red nginx:

```text
ticketz-docker-acme_nginx-proxy
```

Se restauró con:

```bash
docker network connect ticketz-docker-acme_nginx-proxy evolution-evolution-api-1
```

Después Evolution quedó conectado a:

```text
evolution_default
ticketz-docker-acme_nginx-proxy
```

### IMPORTANTE

Esta conexión adicional sigue siendo **manual**.

Si Evolution vuelve a recrearse, puede perderse y producir otro 502. Más adelante debe persistirse correctamente en el compose.

---

## 8. Diagnóstico de la API de Typebot

Evolution 2.3.4 con:

```text
TYPEBOT_API_VERSION=latest
```

intenta iniciar Typebot mediante:

```text
POST /api/v1/typebots/{public-id}/startChat
```

Se probó inicialmente:

```text
https://bot.pablete.xyz/api/v1/typebots/.../startChat
```

Resultado:

```text
404
```

También se probó:

```text
https://bot.pablete.xyz/bot/api/v1/typebots/.../startChat
```

Resultado:

```text
404
```

Luego se comprobó directamente contra el Viewer local:

```bash
curl -i -X POST \
  'http://127.0.0.1:3002/api/v1/typebots/lab-json-base-02-variables-i3cuh04/startChat' \
  -H 'Content-Type: application/json' \
  -d '{"prefilledVariables":{}}'
```

Resultado:

```text
HTTP/1.1 200 OK
```

Conclusión:

```text
La API correcta funciona en Typebot Viewer.
El problema estaba en el routing público de nginx.
```

---

## 9. Solución Evolution → Typebot

Se detectó que los contenedores pueden compartir la red:

```text
ticketz-docker-acme_nginx-proxy
```

Se probó desde Evolution:

```bash
docker exec evolution-evolution-api-1 node -e "
fetch('http://typebot-typebot-viewer-1:3000/api/v1/typebots/lab-json-base-02-variables-i3cuh04/startChat',{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({prefilledVariables:{}})
})
.then(async r=>console.log(r.status, await r.text()))
.catch(console.error)
"
```

Resultado:

```text
200
```

Por lo tanto Evolution se comunica directamente con Typebot por Docker.

URL usada en integraciones Evolution → Typebot:

```text
http://typebot-typebot-viewer-1:3000
```

Esto evita depender del routing público de nginx para las llamadas internas.

---

## 10. Primera integración Evolution + Typebot funcionando

Integración creada:

```text
Descripción:
LAB Typebot Variables

URL API Typebot:
http://typebot-typebot-viewer-1:3000

Public ID:
lab-json-base-02-variables-i3cuh04

Trigger:
iniciar lab02

Keyword finish:
salir lab02

Expiración:
5 minutos
```

Prueba WhatsApp:

```text
iniciar lab02
→ Hola, ¿cómo te llamas?

ricardo
→ Mucho gusto ricardo
→ ¿Cuál es tu correo?

ricardo@test.com
→ Gracias. Tu correo es ricardo@test.com
```

Se comprobó que:

```text
salir lab02
```

cerraba correctamente la sesión.

Después:

```text
ricardo
```

ya no generaba respuesta.

Finalmente:

```text
iniciar lab02
```

creaba una nueva sesión desde cero.

---

## 11. Laboratorios realizados en Typebot 6.1

### LAB 01 — Estructura base

Se validó:

```text
version: 6.1
events
groups
blocks
edges
```

También se confirmó que un selector múltiple usa un solo:

```text
choice input
```

con múltiples items.

### LAB 02 — Variables

Se validó:

- Text Input;
- Email Input;
- `variableId`;
- variables globales;
- referencias con `{{nombre}}`.

### LAB 03 — Botones

Se comprobó `choice input` con múltiples opciones y `outgoingEdgeId` por item.

### LAB 04 — Set Variable

Bloque:

```text
Set variable
```

con:

```text
variableId
expressionToEvaluate
```

### LAB 05 — Condition

Comparación validada:

```text
Equal to
```

La salida verdadera pertenece al item de condición. La ruta alternativa puede usar la salida general/default del bloque o la continuación del grupo.

### LAB 06 — HTTP GET

Se probó Webhook/HTTP Request con GET y mapeo de respuesta.

### LAB 07 — HTTP POST

Se probó POST contra httpbin con body usando variables como:

```text
{{nombre_cliente}}
```

### LAB 08 — Headers

Se probó:

```text
Authorization: Bearer {{api_token}}
```

No deben exportarse secretos reales en JSON.

### LAB 09 — JSON generado externamente

Se generó un Typebot 6.1 fuera de Typebot, se importó y funcionó correctamente.

Esto demuestra que podemos construir bots mediante JSON y no únicamente de forma manual.

### LAB 10 — OpenAI

Se configuró:

```text
gpt-5.4-nano
```

Acción:

```text
Generate variables
```

Variables:

```text
intent
platform
service
quantity
```

### LAB 11 — Mapeo de productos

Ejemplo:

```text
1.000 Seguidores — $4.990
```

Variables internas:

```text
service=seguidores
quantity=1000
price=4990
provider_service_id=12345
```

### LAB 12 — Manejo de errores API

Se probó lógica tipo:

```text
api_resultado == ok
```

con ramas success/failure.

### LAB 13 — File Upload

Se intentó usar carga de archivos en Typebot, pero requería S3.

Se decidió NO usar Typebot para almacenar comprobantes.

Flujo previsto:

```text
WhatsApp → Evolution → backend / IA
```

---

## 12. LAB 14 — Variables recibidas desde Evolution

Typebot:

```text
LAB - JSON BASE 14 - EVOLUTION VARIABLES
```

Variables creadas:

```text
remoteJid
pushName
instanceName
ownerJid
serverUrl
whatsappNumber
```

Evolution entregó automáticamente:

```text
remoteJid
pushName
instanceName
ownerJid
serverUrl
```

Ejemplo real:

```text
remoteJid: 56967956815:44@s.whatsapp.net
pushName: Optimiza tus redes
instanceName: yo
ownerJid:
serverUrl: https://evo.pablete.xyz
```

`ownerJid` llegó vacío, pero no impide el funcionamiento.

---

## 13. Normalización del número de WhatsApp

Evolution entrega algunos identificadores así:

```text
56967956815:44@s.whatsapp.net
```

Se creó:

```text
whatsappNumber
```

con expresión:

```text
{{remoteJid}}.split("@")[0].split(":")[0]
```

Resultado:

```text
56967956815
```

Validado correctamente.

---

## 14. LAB 15 — Evolution + IA

Typebot:

```text
LAB - JSON BASE 15 - EVOLUTION + IA
```

Variables:

```text
intent
platform
service
quantity
userMessage
```

Flujo:

```text
WhatsApp
↓
Evolution
↓
Typebot
↓
userMessage
↓
OpenAI Generate variables
↓
intent / platform / service / quantity
```

Prueba:

```text
Quiero comprar 5000 seguidores para Instagram
```

Resultado:

```text
intent: comprar
platform: instagram
service: seguidores
quantity: 5000
```

Validado correctamente.

---

## 15. LAB 16 — IA Routing

Typebot:

```text
LAB - JSON BASE 16 - IA ROUTING
```

Se agregó:

```text
Condition:
intent == comprar
```

Rama verdadera:

```text
Perfecto, te ayudaré a realizar tu compra.
```

Rama alternativa temporal de laboratorio:

```text
Por ahora estoy preparado para ayudarte con compras.
```

Esta última frase era únicamente una respuesta de prueba y NO debe usarse en producción.

---

## 16. Validación del routing

### Compra

Mensaje:

```text
Quiero comprar 3000 seguidores para Instagram
```

Resultado IA:

```text
intent: comprar
platform: instagram
service: seguidores
quantity: 3000
```

Routing correcto hacia la rama de compra.

### Consulta de servicios

Mensaje:

```text
Hola, solo quería consultar qué servicios tienen
```

Inicialmente la clasificación falló.

Se detectó que `quantity` estaba configurado como:

```text
Number
Is required: ON
```

Cuando el mensaje no tenía cantidad, la generación estructurada podía fallar completa.

Se corrigió a:

```text
quantity:
Type = Number
Is required = OFF
```

Después la IA devolvió:

```text
intent: consultar_servicio
platform:
service:
quantity:
```

Correcto.

---

## 17. Mejora del schema de OpenAI

Para `intent` se configuró:

```text
Type: Enum
Is required: ON
```

Valores posibles:

```text
comprar
consultar_precio
consultar_servicio
soporte
saludo
otro
```

Esto evita que la IA invente etiquetas distintas.

`quantity` quedó:

```text
Type: Number
Is required: OFF
```

`platform` y `service` permanecieron como String en esta etapa.

---

## 18. Pruebas finales de IA

### Consulta de precio

Mensaje:

```text
¿Cuánto cuestan 5000 seguidores para Instagram?
```

Resultado:

```text
intent: consultar_precio
platform: instagram
service: seguidores
quantity: 5000
```

Correcto.

### Soporte

Mensaje:

```text
Tengo un problema con mi pedido
```

Resultado:

```text
intent: soporte
platform:
service:
quantity:
```

Correcto.

---

## 19. Estado actual de la integración

Validado:

```text
WhatsApp → Evolution API         ✅
Evolution → Typebot             ✅
Typebot → Evolution             ✅
Sesiones                        ✅
Inicio por palabra clave        ✅
Fin por palabra clave           ✅
Variables Evolution → Typebot   ✅
Número WhatsApp limpio          ✅
OpenAI                          ✅
Generate variables              ✅
Enums                           ✅
Quantity opcional               ✅
Routing por intención           ✅
JSON Typebot importable         ✅
HTTP GET                        ✅
HTTP POST                       ✅
Headers                         ✅
Errores de API                  ✅
```

---

## 20. Public IDs usados en laboratorios

### LAB 02

```text
lab-json-base-02-variables-i3cuh04
```

### LAB 14

```text
lab-json-base-14-evolution-variables-e258hqn
```

### LAB 15

```text
lab-json-base-15-evolution-ia-pzhb8ms
```

### LAB 16

```text
lab-json-base-16-ia-routing-i76jwiu
```

---

## 21. Integraciones Evolution creadas

Ejemplos de trigger:

```text
iniciar lab02
salir lab02

iniciar lab14
salir lab14

iniciar lab15
salir lab15

iniciar lab16
salir lab16
```

URL Typebot usada en Evolution:

```text
http://typebot-typebot-viewer-1:3000
```

---

## 22. Decisión importante: no construir el bot comercial manualmente

Después de terminar los laboratorios se concluyó que ya existe suficiente conocimiento del esquema Typebot 6.1.

Por lo tanto, el bot comercial NO debería construirse manualmente bloque por bloque.

Flujo de trabajo correcto:

```text
Usuario define comportamiento
↓
IA diseña arquitectura
↓
IA genera JSON Typebot 6.1
↓
Usuario importa
↓
Se prueba
↓
IA corrige o regenera JSON
```

Cuando se requiera lógica fuera de Typebot:

```text
IA genera backend / scripts / SQL
```

---

## 23. Skill prevista para el proyecto

La idea original de crear una Skill sigue vigente.

La Skill debe encapsular el conocimiento aprendido durante los laboratorios:

- estructura Typebot 6.1;
- formato JSON;
- variables;
- choices;
- condiciones;
- Set Variable;
- HTTP Requests;
- headers;
- OpenAI Generate Variables;
- Evolution API 2.3.4;
- integración Evolution → Typebot;
- variables automáticas de Evolution;
- limpieza de `remoteJid`;
- sesiones de WhatsApp;
- reglas de seguridad;
- integración futura de APIs.

Objetivo de la Skill:

```text
permitir que la IA genere bots Typebot 6.1 completos,
coherentes y reutilizables sin reconstruir manualmente
cada bloque.
```

---

## 24. BOT COMERCIAL

Se creó una copia:

```text
BOT COMERCIAL - BASE 01
```

pero antes de continuar manualmente se decidió detener ese enfoque.

La siguiente versión debe ser generada principalmente mediante JSON.

---

## 25. Flujo comercial esperado

```text
Cliente escribe por WhatsApp
↓
IA entiende lo que quiere
↓
¿Comprar?
├─ Sí
│  ↓
│  Plataforma
│  ↓
│  Servicio
│  ↓
│  Cantidad
│  ↓
│  Precio
│  ↓
│  Confirmación
│  ↓
│  Pago
│  ↓
│  Verificación
│  ↓
│  Pedido SMM Raja
│  ↓
│  Confirmación al cliente
│
├─ Consultar precio
│  ↓
│  Mostrar precio / opciones
│
├─ Consultar servicio
│  ↓
│  Explicar catálogo
│
├─ Soporte
│  ↓
│  Buscar pedido
│  ↓
│  Estado / atención
│
└─ Saludo / otro
   ↓
   Conversación comercial natural
```

---

## 26. Seguridad

No incluir en JSON exportados:

```text
OpenAI API keys
Evolution API key
SMM Raja API key
Mercado Pago secrets
Telegram token
```

Las credenciales deben vivir en variables de entorno, backend, gestor de secretos o credenciales internas de Typebot.

---

## 27. Riesgos / pendientes técnicos

### 1. Red Docker manual de Evolution

Debe persistirse:

```text
ticketz-docker-acme_nginx-proxy
```

en el compose de Evolution antes de futuras recreaciones.

### 2. Routing público de Typebot

Actualmente:

```text
https://bot.pablete.xyz/api/v1/typebots/.../startChat
```

respondía 404.

La solución actual evita el problema usando comunicación Docker interna.

No es necesario corregirlo inmediatamente mientras Evolution use:

```text
http://typebot-typebot-viewer-1:3000
```

### 3. PostgreSQL comercial

Todavía no se ha creado la base de datos de negocio.

Pendiente:

```text
customers
orders
payments
```

### 4. SMM Raja

Todavía no se ha conectado la API real.

Pendiente:

- autenticar;
- consultar servicios;
- mapear IDs;
- obtener precio proveedor;
- crear pedido;
- consultar estado.

### 5. Mercado Pago

Pendiente:

- crear preferencia/pago;
- recibir webhook;
- verificar pago;
- cambiar estado de order/payment.

### 6. Telegram

Pendiente:

- crear bot administrativo;
- enviar datos de transferencias;
- botones Confirmar / Rechazar;
- actualizar base de datos;
- continuar el flujo automáticamente.

---

## 28. Próxima etapa recomendada

La siguiente etapa NO debería ser otro laboratorio manual.

Debe ser:

```text
FASE 1
Crear la Skill del proyecto con todo el conocimiento validado.

FASE 2
Diseñar la arquitectura del BOT COMERCIAL real.

FASE 3
Generar el primer JSON Typebot 6.1 completo.

FASE 4
Importar y probar.

FASE 5
Agregar backend + PostgreSQL.

FASE 6
Integrar SMM Raja.

FASE 7
Integrar pagos.

FASE 8
Integrar Telegram.

FASE 9
Prueba end-to-end.
```

---

## 29. Principio de trabajo para lo que sigue

Evitar:

```text
construir manualmente cientos de bloques
```

Priorizar:

```text
IA → JSON Typebot 6.1
IA → scripts
IA → backend
IA → SQL
IA → integración de APIs
```

El usuario debe principalmente:

```text
importar
probar
confirmar resultados
```

---

## 30. Conclusión

La fase de aprendizaje y validación terminó con éxito.

Ya está demostrado que:

```text
Evolution 2.3.4
+
Typebot 6.1
+
WhatsApp
+
OpenAI
```

funcionan juntos correctamente en el VPS.

También se validó que la IA puede:

```text
detectar intención
extraer plataforma
extraer servicio
extraer cantidad
enrutar conversaciones
```

y que Evolution puede entregar automáticamente los datos del contacto de WhatsApp a Typebot.

La siguiente etapa es transformar todo este conocimiento en una **Skill reutilizable** y comenzar a generar el **bot comercial real mediante JSON y código**, evitando continuar con construcción manual bloque por bloque.
