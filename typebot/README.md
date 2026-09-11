# BOT WHATSAP Commerce v1 para Typebot

Importa `bot-whatsap-commerce-v1.json` en Typebot 6.1. El template usa únicamente bloques `text`, `text input`, `choice input`, `Set variable`, `Condition` y `Webhook` (HTTP request) observados en los laboratorios locales del proyecto. El bot es determinístico: nunca calcula precios, nunca inventa productos y nunca aprueba pagos. Solo muestra lo que responde el backend.

`bot-whatsap-ai-commerce-v1.json` es la variante ampliada recuperada del despliegue: añade clasificación asistida, catálogo por categorías y listas de paquetes con precios retail mediante `/bot/v1/catalog/packages`. `bot-whatsap-ai-commerce-v1.before-prices.json` es un punto de referencia anterior y no debe publicarse como flujo definitivo.

## Configuración requerida

- `backend_base_url`: URL pública base del backend, sin barra final. No es secreta y debe configurarse al desplegar.
- `backend_token`: credencial machine-to-machine secreta de Bot Gateway. El JSON no contiene ningún valor para esta variable.
- `remoteJid`, `pushName`, `instanceName`, `ownerJid` y `serverUrl`: contexto que la integración con Evolution entrega a la sesión.

El JSON no contiene `businessId`, precios, ids de proveedor ni credenciales: el backend obtiene el negocio desde la credencial.

## Provisión de `backend_token`

`backend_token` es una variable de sesión declarada y **nunca** asignada por un bloque `Set variable`. El validador falla si el template intenta asignarla. Su valor debe inyectarse en runtime desde el orquestador (por ejemplo, al crear la sesión de Typebot con `prefilledVariables` o el mecanismo seguro del despliegue). Nunca debe escribirse en el JSON importable, en variables de prueba, en documentación ni en control de versiones.

El método concreto para provisionar el token en la instalación self-hosted de Typebot no está demostrado por el código ni por la documentación local del repositorio; queda como paso pendiente del deployment.

## Flujo y endpoints

1. **Inicio**: si `remoteJid` viene vacío se pide nombre y teléfono (fallback Viewer); si viene lleno, `whatsappNumber` se deriva quitando sufijo y dispositivo. Luego `POST /bot/v1/customers/resolve` resuelve o crea el cliente.
2. **Menú principal**: `🛍️ Ver servicios`, `❓ Preguntas frecuentes`, `📦 Estado de mi pedido`, `🙋 Hablar con una persona`.
3. **Catálogo**: `GET /bot/v1/products?limit=5&offset=0&type=service` muestra hasta cinco servicios activos y valida una selección de `1` a `5`.
4. **Detalle del producto**: `GET /bot/v1/products/{{selectedProductId}}` obtiene descripción, `minQuantity`, `maxQuantity` y `requiredInputs` reales del producto elegido.
5. **Cantidad**: valida cantidad entera positiva y que esté dentro de `minQuantity`/`maxQuantity` del backend.
6. **Precio**: `POST /bot/v1/quotes` con `{productId, quantity, customerId}`; el resumen muestra `totalPrice` y `currency` tal cual los devuelve el backend.
7. **Venta**: tras confirmación explícita, `POST /bot/v1/orders` con `{quoteId, customerId, fulfillmentInput}`. La orden se crea una sola vez. Si el backend responde `QUOTE_ALREADY_CONVERTED`, el bot no reintenta ni crea otra orden: muestra un aviso y ofrece estado o derivación humana.
8. **Métodos de pago**: `GET /bot/v1/payment-methods` lista hasta tres métodos activos. El cliente elige por número.
9. **Pago**: `POST /bot/v1/orders/{{orderId}}/payments` con `{paymentMethodId}` y header `Idempotency-Key: {{paymentIdempotencyKey}}`. Si es Mercado Pago se muestra `checkoutUrl`; si es transferencia (`bank_transfer`) se muestran `accountHolder`, `rut`, `bankName`, `accountType`, `accountNumber` y `email` de `config` y se explica que queda pendiente de confirmación humana. El bot nunca marca un pago como aprobado.
10. **Estado del pago**: `GET /bot/v1/payments/{{paymentId}}` refleja `pending`, `approved`, `rejected`, `cancelled`, `expired`, `failed`, `refunded` y `chargeback`.
11. **Postventa**: `GET /bot/v1/orders/{{orderId}}` y `GET /bot/v1/orders/{{orderId}}/fulfillments` reflejan el estado del pedido y de la preparación (`pending`, `submitting`, `submitted`, `in_progress`, `completed`, `partial`, `cancelled`, `failed`, `submission_unknown`). Los estados `partial`, `failed`, `submission_unknown` y `cancelled` derivan a una persona.
12. **FAQ y derivación**: mensajes comerciales y de soporte inicial, más una opción explícita `🙋 Hablar con una persona`.

Los `Set variable` en modo código obtienen los datos de `requiredInputs` sin claves fijas: el bot arma `fulfillmentInput` con las claves y los tipos reales que devuelve el backend.

Todos los Webhooks usan `Authorization: Bearer {{backend_token}}`; los POST agregan `Content-Type: application/json`. Los `GET` de fulfillment son de solo lectura para el cliente.

## `fulfillmentInput`: mecanismo y límites

El producto real trae `requiredInputs` (posiblemente vacío). El bot:

1. Mapea hasta **3** campos (`key`, `label`, `type`) desde `requiredInputs[0..2]`.
2. Detecta si existe un cuarto campo con `requiredInputs[3].key`; si existe, **no** arma el pedido y deriva a una persona (limitación explícita).
3. Cuenta los campos presentes en una expresión de código y guarda `selectedInputCount`.
4. Pide cada campo con su `label` real, valida que no esté vacío; para `url` exige `http://` o `https://`, y para `integer` exige entero. `text`, `textarea` y `date` se aceptan como texto no vacío.
5. Construye `fulfillmentInput` en una expresión de código (`JSON.stringify`) que solo usa las `key` devueltas por el backend. Si el producto no requiere campos, envía `{}`.
6. El body de `POST /orders` incluye `"fulfillmentInput": {{fulfillmentInput}}` (objeto JSON, no cadena).

Límites reales:

- Máximo 3 campos por producto. Productos con 4 o más `requiredInputs` derivan a humano.
- Todos los campos listados en `requiredInputs` se piden y se exigen no vacíos, aunque el backend los marque con `required: false`; el bot no distingue opcionales.
- La validación de longitud/rango de `validation` (`minLength`, `maxLength`, `minimum`, `maximum`) no se replica en el bot; el backend sigue siendo la fuente de verdad y puede rechazar el valor.
- Si el cliente escribe comillas dobles dentro de un valor, la interpolación de variables en modo código puede romper la expresión; es un caso raro y no cubierto.
- Se listan hasta 3 métodos de pago activos. Si el negocio expone más, solo los tres primeros quedan disponibles en el bot.

## Variables del template

- contexto: `remoteJid`, `pushName`, `instanceName`, `ownerJid`, `serverUrl`, `whatsappNumber`;
- backend y errores: `backend_base_url`, `backend_token`, `backendErrorCode`, `backendErrorMessage`;
- customer: `customerId`, `customerName`;
- catálogo: `product1Id/product1Name/product1Min/product1Max` … `product5Id/product5Name/product5Min/product5Max`;
- selección: `productSelection`, `selectedProductId`, `selectedProductName`, `quantityInput`, `quantity`, `quantityValid`;
- detalle: `selectedProductDescription`, `selectedProductMin`, `selectedProductMax`;
- inputs comerciales: `selectedInput1Key/Label/Type` … `selectedInput3Key/Label/Type`, `extraInputKey`, `selectedInputCount`, `input1Value`/`input2Value`/`input3Value`, `field1Valid`/`field2Valid`/`field3Valid`, `fulfillmentInput`;
- quote: `quoteId`, `quoteProductName`, `quoteQuantity`, `quoteCurrency`, `quoteTotal`, `quoteStatus`;
- order: `orderId`, `orderStatus`, `orderItemId`, `orderTotal`, `orderCurrency`;
- pagos: `paymentMethod1Id/Type/Name` … `paymentMethod3Id/Type/Name` con sus campos `AccountHolder/Rut/BankName/AccountType/AccountNumber/Email`, `paymentMethodSelection`, `selectedPaymentMethodId/Type/Name`, `bankAccountHolder`, `bankRut`, `bankName`, `bankAccountType`, `bankAccountNumber`, `bankEmail`;
- pago: `paymentId`, `paymentStatus`, `checkoutUrl`, `paymentExpiresAt`, `paymentIdempotencyKey`;
- postventa: `fulfillmentId`, `fulfillmentStatus`, `fulfillmentSubmittedAt`, `fulfillmentCompletedAt`.

`paymentIdempotencyKey` se calcula una vez por orden como `typebot-payment-{{orderId}}-v1`, de modo que reintentos del mismo pedido no dupliquen el pago.

## Prueba desde Viewer

Si `remoteJid` llega vacío, el flujo pide nombre y teléfono. Esto permite probarlo desde Viewer sin Evolution. Si `remoteJid` existe, `whatsappNumber` se deriva antes de llamar a Customer Resolve.

Para que la prueba sea representativa, inyecta `backend_base_url` y `backend_token` como variables de sesión; no modifiques el JSON.

## Validación offline

Desde la raíz del repositorio:

```bash
node typebot/validate-typebot.mjs
node --test typebot/validate-typebot.test.mjs
```

El validador usa solo Node.js estándar y revisa estructura, referencias, variables, endpoints obligatorios, headers, ausencia de secretos, condiciones `Is empty`, rutas de arrays con corchetes y la conversión segura de cantidad en modo código.

Reglas específicas de fulfillments: solo se permite `GET {{backend_base_url}}/bot/v1/orders/{{orderId}}/fulfillments` y `GET {{backend_base_url}}/bot/v1/fulfillments/{{fulfillmentId}}`. Se prohíben los POST de dispatch/sync y cualquier otro endpoint de fulfillment. También se prohíben `businessId`, `provider_service_id`, `providerServiceId`, `externalServiceId`, costes de proveedor y claves de API.

El módulo no lee archivos ni imprime nada al importarse. Exporta `validateTypebotDocument(document)` para un objeto ya parseado, `validateTypebotTemplate(raw)` para un string JSON y `validateTypebotSemantics(blocks)` para las reglas semánticas de los bloques. La lectura del archivo, la validación y el mensaje `Typebot template valid` solo ocurren al ejecutar el archivo directamente.

## Alcance del template base

- Evolution no está desplegado ni configurado en este repositorio.
- El mecanismo seguro de provisionamiento del token en Typebot self-hosted queda pendiente del deployment.
- El template base no usa OpenAI, polling automático, workers, queues ni frontend. La variante `ai-commerce` sí contiene bloques OpenAI y requiere seleccionar una credencial en Typebot después de importarla.
- Typebot no llama Fulfillment ni conoce IDs, costes o inputs internos de proveedores.
- El bot no aprueba pagos: la confirmación bancaria es humana y el estado del pago solo se refleja desde el backend.
- Un pago aprobado solo muestra confirmación. La preparación automática del servicio se conectará en una etapa posterior.
- No hay notificaciones proactivas: el cliente debe consultar el estado desde el menú.
