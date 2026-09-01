# Ventas y automatización: límites de confianza

## Separación de responsabilidades

- Sales: estado de conversación por Business/contacto; llama a BotGatewayService para catálogo, quotes, orders y payments. No SQL en services/controllers.
- SalesDeliveryService: valida contrato comercial y capabilities del adapter sin llamadas externas. Snapshot de mapping/servicio/inputs antes del pago, revalidado al confirmar, pagar y despachar.
- Fulfillments: sigue siendo quien comprueba Order paid y evita duplicación de compras externas. Un parámetro interno opcional compara el servicio esperado por el checkout dentro de la transacción que crea el snapshot; no lo acepta HTTP.
- PaymentReviews: guarda imagen y lectura opcional cifradas, hash de evidencia, revisión, actor y referencia. Un comprobante nunca es una confirmación bancaria.
- Automation: obtiene trabajo desde filas persistidas, reconcilia estado pagado sin modificar el contrato de webhooks financieros y utiliza notificaciones con clave de evento única.
- n8n: transporte, coordinación Typebot, asesoría OpenAI y avisos. No calcula importes ni cambia directamente PostgreSQL.

## Autenticación

El token machine pertenece a un negocio y sólo abre sesiones/importa mensajes. Cada sesión recibe token aleatorio `cs_…`, almacenado como SHA-256 y válido 24 horas; sólo opera sobre ese cliente. Las rutas de conversación no aceptan business/customer/payment ni estado approved como autoridad proporcionada por el caller.

El worker emplea una credencial **diferente**, cifrada en integración `automation_runner`. Puede reclamar trabajos y obtener comprobantes privados; no se entrega a Typebot ni a OpenAI. El cliente HTTP no elige el negocio: se deriva de la integración activa y su secreto.

Telegram exige integración exacta, header secreto comparado en tiempo constante, chat configurado y usuario Telegram vinculado a cuenta owner/admin activa. El callback es aleatorio, acotado al pago y expira en 48 horas. La referencia de abono y el actor se persisten antes de confirmar el pago; una repetición completa una aprobación ya comprometida sin duplicarla.

Los owners/admins son responsables de vincular correctamente sus identidades Telegram. El backend no prueba por sí mismo la propiedad del ID escrito en el panel. Usar cuentas humanas individuales y no compartir credenciales de administración.

## Durabilidad e idempotencia

- Inbox único por negocio/contacto/messageId; repetir un ID con otro contenido es conflicto.
- Se reclama sólo la cabeza de cada contacto; lease, máximo ocho intentos y recuperación explícita en panel. Los mensajes posteriores no adelantan uno fallido.
- La respuesta conversacional y el estado se confirman juntos. Un mensaje repetido devuelve la misma decisión comercial. OpenAI puede redactar otra asesoría después de una caída; no cambia la decisión financiera.
- Orders conserva quote único; si cae el proceso después del commit se recupera por quote. Payments usa Idempotency-Key estable por checkout/método.
- La evidencia se deduplica por pago/hash; una observación IA queda marcada no confiable y nunca contiene una acción autorizante.
- El ACK del inbox marca completado y agrega la respuesta a la cola en una transacción. Las colas usan `FOR UPDATE SKIP LOCKED` y sólo aceptan ACK de la lease vigente y del negocio correcto.
- Los bloqueos advisory de sesión NO son transacciones: ninguna llamada a servicios externos ocurre dentro de una transacción SQL. Se reserva capacidad del pool para las consultas internas y se rechaza sobrecarga con `SALES_BUSY`.
- El scheduler puede repetir reconciliación; las claves únicas de eventos impiden volver a encolar el mismo aviso. Un fallo después del envío externo y antes del ACK puede repetir una notificación (at-least-once).
- Un fulfillment ambiguo jamás se reintenta automáticamente. Esta garantía financiera es independiente de la cola de mensajes.

## Datos personales y validación

Los cuerpos y credenciales de request se ocultan en logs. No se almacena una URL pública de comprobante: n8n obtiene bytes mediante Evolution autenticado; el backend limita tamaño y tipo y los cifra con AES-GCM. La validación de formato/tamaño no certifica autenticidad de una imagen.

La lectura de OpenAI es optativa, estructurada y no confiable. La comparación automática de importe es conservadora para CLP entero; otro formato/moneda requiere interpretación humana. No hay umbral de confianza que apruebe pagos.

La retención configurable limpia evidencia cifrada y tokens vencidos durante el worker. Auditoría financiera, hashes y registros de mensajes no se purgan automáticamente; proteger backups y restringir su acceso. La eliminación local no elimina copias en terceros.

URLs comerciales se validan HTTP/S, sin credenciales y máximo 2048 caracteres; fechas se verifican como días reales ISO. El servicio no navega las URLs del cliente. El endpoint Typebot→n8n tiene destino fijo, no elegible mediante variables prefijadas del visitante.

## Desactivación y salida humana

Por defecto enabled/autoDispatch son falsos. HUMANO pausa el diálogo y avisa al equipo. BAJA detiene respuestas y notificaciones WhatsApp pendientes, sin cancelar pagos o compras existentes. La entrega de productos sin mapping es manual y queda auditada; no se inventó un mecanismo de descarga de archivos o licencias.

Ver [guía operativa](../../flows/OPERACION.md) antes de activar los flujos. Esta implementación local no certifica compatibilidad runtime ni autorización comercial de plataformas externas.
