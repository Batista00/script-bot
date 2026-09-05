# Importación y configuración: Evolution 2.3.4 + Typebot 6.1 + n8n

Estado de entrega: código y exports generados sin secretos. Se importan desactivados; las pruebas con dinero real sólo se hacen tras revisar esta configuración.

## 1. Preparar el backend y el negocio

1. Respaldar PostgreSQL y la clave `INTEGRATIONS_ENCRYPTION_KEY` del despliegue. No regenerar esta clave si ya existen credenciales cifradas.
2. Desplegar backend y panel de esta misma revisión. En `backend`: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm build`, `pnpm migrate`. Se necesita la migración **000015**. Reiniciar usando el procedimiento del despliegue existente.
3. Confirmar `https://admin.pablete.xyz/api/health` → HTTP 200 con JSON `{"status":"ok"}`. No sirve recibir el HTML del panel. Los exports asumen que `/api/` se redirige al backend eliminando ese prefijo.
4. El proxy debe admitir 3 MB en `/api/`; el backend acepta comprobantes JPG/PNG de máximo 2 MB binarios. Los ejemplos Nginx del repositorio incorporan `client_max_body_size 3m`. No reemplazar la configuración TLS real a ciegas con un archivo de ejemplo.
5. En el negocio configurar moneda, productos activos, precios y métodos de pago. Precio fijo sirve para paquetes; precio unitario multiplica cantidad. Los costes USD de Raja **no** fijan precios ni convierten monedas automáticamente.
6. Para productos SMM revisar mapping, cantidad mínima/máxima y campos requeridos (URL, comentarios, etc.). Sólo los tipos soportados admiten venta automática. Los tipos no verificados pueden importarse inactivos para configuración posterior.
7. Configurar transferencia con titular, RUT, banco, tipo/número de cuenta y correo opcional. Mercado Pago reutiliza su integración y webhook verificado existentes; actualmente sólo CLP. Webpay no está implementado.

## 2. Credenciales: dónde se guardan

Nunca introducir claves en los JSON exportados, nodos Code, variables Typebot, URLs compartidas ni Git. Rotar la clave de administración Typebot compartida por chat; estos flujos no la necesitan.

| Ubicación | Credencial | Uso |
|---|---|---|
| Backend → Integraciones → Telegram | `botToken` + `webhookSecret` | Validar y responder acciones humanas de Telegram |
| Backend → Integraciones → Automation Runner | `runnerSecret` | Ejecutar colas/reconciliación de **ese** negocio |
| Backend → API Credentials | Token machine `bw_…` | Abrir conversaciones y persistir mensajes; no aprobar pagos |
| Typebot → credencial OpenAI | API key en el almacén seguro de Typebot | Único modelo conversacional de ventas (`Ask Model`) |
| n8n → `BW Backend` (Header Auth) | Header `Authorization`, valor `Bearer <token machine>` | Flujos 01 y 03 |
| n8n → `BW Automation Runner` (Header Auth) | Header `Authorization`, valor `Bearer <runnerSecret>` | Flujos 03 y 04 |
| n8n → `BW Evolution Webhook` (Header Auth) | Header `x-bw-webhook-secret`, secreto aleatorio propio | Autenticar entrada desde Evolution |
| n8n → `Evolution API` (Header Auth existente) | Header `apikey`, clave de Evolution | Descargar media y enviar WhatsApp |
| n8n → `OpenAI account` (existente) | API key de OpenAI | Sólo lectura visual opcional y no autoritativa de comprobantes; no conversación |
| n8n → `Telegram Ventas Admin` (existente) | Token del mismo bot Telegram del backend | Enviar avisos y comprobantes |

Generar secretos diferentes de al menos 32 caracteres aleatorios para `runnerSecret`, `webhookSecret` y el webhook Evolution. Para Telegram usar caracteres admitidos por `secret_token` (letras, números, `_`, `-`), máximo 256. Guardarlos en el gestor seguro y pegar sólo en sus formularios. `N8N_ENCRYPTION_KEY` cifra el almacén de n8n: **no es una API key de OpenAI** y no va en ningún nodo.

El formulario de Integraciones muestra campos write-only. Al rotar Telegram completar **ambos** secretos, porque el objeto de credenciales se reemplaza completo. Copiar el UUID no secreto de la integración `automation_runner` para el paso 4. Se ve en la respuesta/listado HTTP de Integraciones; no es la API key.

## 3. Configurar atención y revisores

En **Bot y automatizaciones** del negocio:

- Completar nombre, bienvenida, preguntas frecuentes/políticas y contacto humano. La IA sólo usa esa información y el catálogo mostrado; no debe prometer resultados, descuentos ni pagos aprobados.
- Indicar el **chat ID** de Telegram donde llegarán ventas y comprobantes. Para grupos suele ser negativo. No confundirlo con el ID de usuario del revisor.
- Como owner/admin, vincular **tu propio ID numérico de usuario Telegram** a tu cuenta del panel. Cada revisor debe tener una cuenta activa y rol owner/admin en el negocio; el rol se revisa en cada decisión.
- Mantener recepción de ventas y despacho automático apagados mientras se importa. El despacho automático puede consumir saldo real de Raja después de un pago válido.
- Configurar retención de comprobantes (por defecto 30 días, rango 2–90). La limpieza requiere que siga ejecutándose el worker. Revisar también retención y permisos de Telegram, n8n, Typebot y backups.

## 4. Importar Typebot y n8n

1. En el builder Typebot importar `typebot/sales-assistant-6.1.json`. Su estructura es versión 6.1. El dominio `bot.pablete.xyz` debe servir la API del **viewer**; si sólo sirve el builder, usar el dominio viewer real en n8n.
2. En el bloque HTTP comprobar destino fijo `https://n8n.pablete.xyz/webhook/bw-sales-bridge`. Para otro negocio usar una ruta propia. No convertir este destino en una variable prefijada por el cliente: permitiría elegir destinos de solicitudes server-side.
3. Abrir el bloque **Asesor comercial OpenAI**, seleccionar una credencial OpenAI de Typebot y revisar el modelo. El JSON no contiene `credentialsId` ni API key. Existe un solo `Ask Model`, con Response ID para contexto lingüístico; el backend conserva el estado comercial.
4. Publicar al comenzar las pruebas autorizadas y copiar el `publicId` publicado (no el ID interno). El flujo espera el siguiente `text input`: `startChat` abre la sesión y `continueChat` entrega los turnos posteriores.
5. Importar los JSON de `n8n/`. Para el camino nativo de Evolution activar únicamente **BW 02** como puente conversacional; BW 01 y BW 03 deben permanecer desactivados para evitar procesamiento y respuestas duplicadas. Seleccionar manualmente las credenciales de la tabla anterior en **cada nodo**; los exports contienen nombres, nunca IDs ni secretos.
6. Editar el nodo **Config** de cada workflow:

   - `backendBaseUrl`: `https://admin.pablete.xyz/api`, sin barra final.
   - `typebotBaseUrl`: `https://bot.pablete.xyz`, o viewer real, sin barra final.
   - `n8nBaseUrl`: `https://n8n.pablete.xyz`, sin barra final; se usa sólo para disparos internos inmediatos autenticados.
   - `typebotPublicId`: publicId del bot publicado.
   - `evolutionBaseUrl`: `https://evo.pablete.xyz`, **sin `/manager`**.
   - `instance`: nombre exacto de la instancia WhatsApp de este negocio.
   - `automationIntegrationId`: UUID de la integración `automation_runner` del mismo negocio.
   - `openaiModel`: modelo disponible en tu cuenta que admita Chat Completions; para lectura de imágenes debe admitir visión y Structured Outputs. No dejar `CONFIGURAR_MODELO`.
   - `evidenceAiEnabled`: `false` por defecto. Activar sólo después de informar sobre el envío del comprobante a OpenAI, revisar privacidad/costes y validar el modelo elegido.

7. En BW 02 comprobar `Validate Typebot turn`, `Open current sales session` y `Execute authorized operation`, en ese orden. Typebot sólo conserva su propio contexto; BW 02 renueva el Bearer `cs_` y lo usa directamente contra `/conversation/v1/message`. Los exports usan HTTP Request 4.2, Code 2, Webhook 2, Respond 1.4, Schedule 1.2, IF 2.2, Telegram 1.2 y Loop Over Items 3, compatibles con n8n 2.36.7.
8. Mantener desactivado el guardado de datos de ejecuciones exitosas, fallidas y manuales. No fijar `pinData` con conversaciones, headers, imágenes ni tokens. Los resultados Typebot contienen un token temporal acotado a una conversación; restringir acceso y retención. No dar acceso de edición a clientes finales.

Los JSON de `typebot/` antiguo permanecen como referencia histórica. No activar simultáneamente el flujo viejo y el nuevo para la misma instancia.

## 5. Entrada Evolution 2.3.4

Configurar la integración Typebot de la instancia con la URL del viewer, el `publicId` publicado, disparador `all`, un retardo corto y la recepción habilitada. Evolution llama `startChat` al iniciar el contacto y conserva el `sessionId`; los mensajes siguientes usan `continueChat` sobre la misma conversación.

No activar simultáneamente el webhook `bw-evolution-sales`, BW 01 o BW 03 para la misma instancia: ese camino también consume `MESSAGES_UPSERT` y produciría dos procesadores. En el diseño nativo, Typebot recibe `remoteJid`, `pushName` y el texto desde Evolution; Typebot llama BW 02 sólo cuando necesita abrir la sesión o ejecutar una operación comercial.

BW 02 normaliza `remoteJid` a teléfono, abre `/bot/v1/sales/sessions` con la credencial machine y usa exclusivamente el `sessionToken` recién obtenido para `/conversation/v1/message`. El token no se devuelve a Typebot y el ID de turno permite que un reintento no repita una operación distinta.

## 6. Telegram: webhook directo al backend

El bot Telegram debe pertenecer al administrador, poder escribir en el chat y recibir sus mensajes. El webhook apunta al **backend**, no a un nodo Telegram Trigger de n8n:

`https://admin.pablete.xyz/api/webhooks/telegram/<UUID_INTEGRACION_TELEGRAM>`

Al iniciar pruebas autorizadas registrar `setWebhook` de Telegram usando el token del bot desde el gestor seguro, con `url` anterior, `secret_token` igual al `webhookSecret` cifrado del backend y `allowed_updates: ["message","callback_query"]`. No poner el token real en scripts versionados, terminal grabada ni capturas.

Telegram mantiene un webhook por bot. Un Telegram Trigger activo del mismo bot en n8n reemplazaría esta configuración: revisar primero qué lo utiliza y evitar interrumpir otras automatizaciones. Usar un bot dedicado si hay conflicto. Confirmar con `getWebhookInfo` durante las pruebas.

El aviso incluye imagen privada, pedido, monto esperado y tres botones. **Verificar y aprobar** pide consultar el banco y escribir `/abono <referencia-de-revisión> REFERENCIA_BANCARIA`. Sólo entonces se aplica la aprobación humana auditada. Rechazar/pedir información no paga el pedido. El token de revisión caduca en 48 horas.

## 7. Activación controlada y prueba posterior

Orden: backend → credenciales → importar Typebot → asignar OpenAI y publicar → activar BW 02 → desactivar BW 01/BW 03 → habilitar la integración nativa Typebot de Evolution → habilitar recepción del negocio. Mantener `autoDispatch=false` hasta verificar pagos y acordar una compra de prueba.

Antes de tocar cuentas reales seguir [OPERACION.md](OPERACION.md). Para cada negocio adicional, duplicar el conjunto con sus propias rutas webhook, Typebot publicado, credenciales, integración runner, instancia, chat y revisores. No mezclar un runner de A con el token machine de B.

## Verificación local sin servicios externos

En `backend`: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm build`, `pnpm test`.
En `admin`: los mismos comandos y `pnpm lint`.
Desde la raíz, compatible Windows/Linux:

```bash
node flows/scripts/generate.mjs
node --test flows/tests/importables.test.mjs flows/tests/transport.test.mjs
```

Las pruebas PostgreSQL se omiten explícitamente sin `TEST_DATABASE_URL`; nunca usar producción como base de tests. El validador de exports comprueba JSON, referencias y fixtures: **no sustituye una importación real en Typebot/n8n**.

## Referencias verificadas

- [Evolution 2.3.4: configuración y headers del webhook](https://github.com/EvolutionAPI/evolution-api/blob/2.3.4/src/api/integrations/event/webhook/webhook.controller.ts).
- [Typebot: startChat y prefilledVariables](https://docs.typebot.com/api-reference/chat/start-chat).
- [Telegram: setWebhook y secret_token](https://core.telegram.org/bots/api#setwebhook).
- [OpenAI: salida estructurada](https://developers.openai.com/api/docs/guides/structured-outputs) y [límites de lectura de imágenes](https://developers.openai.com/api/docs/guides/images-vision). Un JSON válido o un monto coincidente no autentican una transferencia.
