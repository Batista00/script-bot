# BOT WHATSAP Commerce v1 para Typebot

Importa `bot-whatsap-commerce-v1.json` en Typebot 6.1. El template usa únicamente bloques `text`, `text input`, `choice input`, `Set variable`, `Condition` y `Webhook` observados en los laboratorios locales del proyecto.

## Configuración requerida

- `backend_base_url`: URL pública base del backend, sin barra final. No es secreta y debe configurarse al desplegar.
- `backend_token`: credencial machine-to-machine secreta de Bot Gateway. El JSON no contiene ningún valor para esta variable.
- `remoteJid`, `pushName`, `instanceName`, `ownerJid` y `serverUrl`: contexto que una integración futura con Evolution deberá entregar a la sesión.

El método concreto para provisionar `backend_token` de forma segura en la instalación self-hosted de Typebot no está demostrado por el código ni por la documentación local del repositorio. Por tanto, su inyección segura queda como paso pendiente del deployment. Nunca se debe escribir el valor en el JSON importable, variables de prueba, documentación ni control de versiones.

## Prueba desde Viewer

Si `remoteJid` llega vacío, el flujo pide nombre y teléfono. Esto permite probarlo desde Viewer sin Evolution. Si `remoteJid` existe, `whatsappNumber` se deriva quitando el sufijo y el identificador de dispositivo antes de llamar a Customer Resolve.

## Flujo y endpoints

1. Resuelve o crea el cliente con `POST /bot/v1/customers/resolve`.
2. Obtiene hasta cinco servicios activos con `GET /bot/v1/products?limit=5&offset=0&type=service`.
3. Valida una selección numérica de `1` a `5` y una cantidad entera positiva.
4. Crea el Quote con `POST /bot/v1/quotes`; el total mostrado proviene exclusivamente de `totalPrice` del backend.
5. Tras confirmación explícita, crea el Order con `POST /bot/v1/orders`.
6. Construye `paymentIdempotencyKey` como `typebot-{{orderId}}-mercado-pago-v1` y crea el Payment con `POST /bot/v1/orders/:orderId/payments` usando `providerKey: mercado_pago`.
7. Muestra `checkoutUrl` y consulta manualmente `GET /bot/v1/payments/:paymentId` cuando el usuario elige revisar el pago.
8. Enruta `approved`, `pending`, `rejected`, `cancelled`, `expired` y `failed` sin permitir que Typebot apruebe un pago.

Todos los Webhooks usan `Authorization: Bearer {{backend_token}}`; los POST agregan `Content-Type: application/json`. Ninguno envía `businessId`: el backend obtiene el Business desde la credencial.

## Variables del template

El flujo declara como variables de sesión:

- contexto: `remoteJid`, `pushName`, `instanceName`, `ownerJid`, `serverUrl`, `whatsappNumber`;
- backend: `backend_base_url`, `backend_token`;
- customer: `customerId`, `customerName`;
- catálogo: los slots `product1Id/product1Name/product1Min/product1Max` hasta `product5Id/product5Name/product5Min/product5Max`;
- selección: `productSelection`, `selectedProductId`, `selectedProductName`, `quantityInput`, `quantity`;
- quote: `quoteId`, `quoteProductName`, `quoteQuantity`, `quoteCurrency`, `quoteTotal`, `quoteStatus`;
- order: `orderId`, `orderStatus`, `orderItemId`, `orderTotal`;
- payment: `paymentId`, `paymentStatus`, `checkoutUrl`, `paymentExpiresAt`, `paymentIdempotencyKey`.

## Validación offline

Desde la raíz del repositorio:

```bash
node typebot/validate-typebot.mjs
```

El validador usa solo Node.js estándar y revisa estructura, referencias, variables, endpoints, headers y ausencia de secretos.

## Fuera de alcance

- Evolution no está desplegado ni configurado en este repositorio.
- El mecanismo seguro de provisionamiento del token en Typebot self-hosted queda pendiente del deployment.
- No hay OpenAI, polling automático, workers, queues ni frontend.
- Typebot no llama Fulfillment ni conoce IDs, costes o inputs internos de proveedores.
- Un pago aprobado solo muestra confirmación. La preparación automática del servicio se conectará en una etapa posterior.
