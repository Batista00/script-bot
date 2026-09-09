# Operación y pruebas controladas

## Recorrido comercial implementado

```text
WhatsApp → Evolution webhook → BW 01 inbox → BW 03 claim + sesión vigente
  → Typebot startChat/continueChat → BW 02 + backend → OpenAI conversacional
  → ACK inbox → BW 04 → Evolution → WhatsApp
  → catálogo → cantidad + datos → cotización → confirmación → pedido
  → Mercado Pago verificado / transferencia revisada por humano
  → pedido pagado → worker → proveedor o entrega manual
  → outbox durable → intento inmediato → Evolution → WhatsApp
  → schedules de recuperación para inbox/outbox pendientes
```

El backend decide importes, moneda, disponibilidad y transiciones. El único OpenAI conversacional está en el bloque Typebot **Ask Model** y sólo redacta asesoría a partir del contexto autorizado del turno; el descubrimiento y avance comercial siguen pasando por el backend. No tiene herramientas para modificar pedidos, aprobar pagos ni comprar al proveedor. La lectura visual opcional de comprobantes es otra función no autoritativa y no conversa con el cliente.

## Comandos del cliente

- `HOLA`: saluda y pregunta qué plataforma/servicio necesita el cliente. El cliente puede responder libremente, por ejemplo «busco seguidores de Instagram»; el backend muestra sólo coincidencias activas con su precio retail.
- `CATÁLOGO`, `MENÚ`: lista productos comerciales disponibles, cinco por página.
- `BUSCAR nombre`: busca nombre/SKU; `MÁS`: siguiente página.
- Número/nombre/cantidad ofrecida → campos requeridos en orden. Se aceptan frases como «quiero los 1.000». URLs HTTP/S válidas, fechas AAAA-MM-DD reales y comentarios uno por unidad en los servicios que lo requieren.
- `CONFIRMAR` o una confirmación natural como «sí, están bien»: acepta el snapshot de precio y crea el pedido. Después puede elegirse el número o decir «transferencia bancaria», «tarjeta» o «Mercado Pago».
- `ESTADO`: consulta la compra seleccionada más reciente. Volver al catálogo no borra ese pedido. Una nueva cotización pasa a ser la compra seleccionada; para otros pedidos usar atención humana/panel.
- Imagen JPG/PNG de hasta 2 MB: comprobante del pago de transferencia seleccionado. No PDF, audio o vídeo en esta entrega.
- `CANCELAR`: abandona la selección actual y vuelve al catálogo; **no cancela un pedido ya creado**. El humano puede cancelar uno pendiente desde Pedidos.
- `HUMANO`: pausa respuestas conversacionales y avisa al equipo en Telegram. Reanudar desde el panel; pagos/entregas existentes conservan seguimiento.
- `BAJA`/`STOP`: deja de responder y suprime notificaciones WhatsApp pendientes para ese contacto. `ALTA` restablece respuestas. No cancela compras. Un mensaje ya enviado al transportador no puede retirarse.

## Qué comprobar antes de un pago real

1. Acordar un negocio/cliente de prueba y mantener compra automática al proveedor apagada.
2. Confirmar importación sin nodos desconocidos, credenciales asignadas y `GET /health` JSON 200.
3. Enviar `HOLA`: recibir una sola respuesta. Repetir el mismo evento técnico: no duplicar pedido/respuesta en la cola.
4. Probar negocio A/B: catálogos, pedidos, chats, runner y revisión de A no accesibles con credenciales de B.
5. Seleccionar servicio SMM. Probar enlace inválido, cantidad fuera de rango y comentarios insuficientes. Debe rechazar antes de crear un cobro o llamar Raja.
6. Confirmar precio retail del negocio, no rate del proveedor. Probar paquete fijo y precio unitario.
7. Crear pedido de prueba y transferencia pendiente. Subir comprobante: el pago continúa pendiente. Si se habilitó lectura IA, su aviso separado debe decir **NO VERIFICADA**; probar imagen ilegible y monto diferente.
8. Pulsar botón con usuario Telegram no vinculado, revisión expirada y rol revocado: rechazar, sin pago ni entrega.
9. Verificar abono real en la cuenta bancaria antes de enviar `/abono … referencia`. Repetir acción: misma aprobación, sin compra adicional. La referencia debe identificar un abono único, no ser el UUID del pedido.
10. En Mercado Pago, primero usar sus herramientas/cuentas de prueba. Un redirect o captura no aprueba; sólo el webhook firmado y consulta del backend pueden hacerlo. Validar monto/moneda.
11. Después de autorización explícita, habilitar despacho de un servicio soportado y de coste acordado. Ver un solo pedido externo; seguirlo hasta estado terminal.
12. Probar un producto sin mapping: requiere entrega humana. Sólo registrar entrega en el panel cuando se haya realizado y el pedido esté pagado; incluir una referencia/nota.
13. Pausar/reanudar conversación y probar BAJA/ALTA. Reiniciar n8n entre pasos y verificar recuperación. No provocar compras repetidas para probar timeouts.

## Recuperación y alertas

Las colas usan identificadores únicos, leases de cinco minutos y máximo ocho intentos. El camino normal dispara procesamiento y entrega de inmediato; los schedules de un minuto sólo recuperan pendientes si falla ese disparo o un servicio está caído. El inbox mantiene el orden por contacto y bloquea mensajes posteriores si el primero falla. Corregir conexión/credenciales y usar **Reprocesar mensaje** en el panel. No borrar registros para reiniciar una venta.

El backend conserva el `sessionId` de Typebot; BW 03 lo usa para continuar el diálogo. BW 02 resuelve cada turno mediante inbox y lease vigentes antes de obtener un token comercial. `continueChat` puede omitir sessionId en su respuesta: el worker conserva el anterior sólo en ese caso. Los HTTP Request guardan el cuerpo de texto explícitamente en `body`. Un token `cs_` nunca se almacena en Typebot.

El outbox conserva el texto versionado y BW 04 reúne sus bloques con saltos de línea en un único envío Evolution y un ACK. Los claims se serializan por negocio/canal/destinatario. La rama pausada no llama al modelo ni reutiliza la respuesta anterior. No activar otro emisor conversacional para la misma instancia.

`business_context` contiene únicamente políticas, opciones retail, selección, requisitos y estado públicos del negocio actual. Typebot usa un solo prompt y una llamada conversacional por turno atendido. Las dudas no borran la selección; «mismo perfil» reutiliza el dato anterior sólo tras petición explícita y nueva confirmación del resumen. Reclamos y precios especiales pausan y alertan Telegram con motivo y estado verificado. Repartir una compra entre varios destinos requiere atención humana: no se crean compras parciales implícitas. Los plazos y garantías sólo pueden afirmarse si están configurados; el tiempo transcurrido se calcula desde un despacho realmente registrado.

Las notificaciones se reconocen sólo tras respuesta satisfactoria del transportador. Si éste envía y el proceso cae antes del ACK, puede repetirse el mensaje: la garantía es **al menos una vez**, no exactly-once. Revisar el destinatario antes de reintentar manualmente una notificación agotada. Los reintentos de cola no son reintentos de compras Raja.

`submission_unknown` o `submitting` tras un reinicio requieren conciliación humana con el proveedor. Nunca se reenvía `action=add` automáticamente en esos estados. Un rechazo `failed`, parcial o cancelado genera alerta operativa. No hay reintegro automático ni chargebacks implementados.

Si cambia el mapping o se desactiva el producto/proveedor después de pagar, se detiene el despacho y avisa al administrador. Revisar la compra o compensación manualmente; no cambiar referencias para forzar otro proveedor.

Si un comprobante caducó, no forzar la revisión con datos falsos: comprobar el pago desde el panel y usar el procedimiento administrativo existente. La aprobación Telegram guarda actor y referencia; la lectura IA jamás sustituye esa auditoría.

## Privacidad y límites de esta entrega

La atención usa trato de usted y la identidad configurada por negocio. Los ejemplos de plazos, garantías y distribución no son promesas universales: sólo se comunican si el servicio los documenta. «Ventas», «agente» y «soporte» reutilizan el traspaso existente a Telegram; ofrecer esa opción no confirma una derivación. «Ayuda» explica las opciones sin pausar la conversación.

El catálogo ya no se resume a tres productos ni se corta a doce líneas en el puente Typebot. Cada consulta muestra todas las opciones de la página (hasta 100 productos, con continuación explícita si hay más), ordenadas por categoría y cantidad. Pedir una cantidad sin coincidencia única conserva las alternativas, sin inventar un paquete ni iniciar otra búsqueda. La selección y el pago siguen siendo determinísticos.

- Comprobantes cifrados con la clave de Integraciones; su eliminación programada afecta el ciphertext, no borra el historial financiero. Los hashes y la auditoría se conservan.
- En n8n los exports desactivan guardado de ejecuciones y datos fijados. Revisar también logs del proxy/Evolution: los eventos de Evolution pueden incluir su API key. No registrar cuerpos ni headers sensibles.
- Telegram y OpenAI son destinatarios externos de datos cuando se activan sus pasos. Usar chat privado restringido, acceso mínimo y política de retención. La retención local no elimina automáticamente copias ya enviadas a Telegram ni backups.
- La lectura IA es optativa y puede equivocarse. Se conserva cifrada y se presenta como observación; ni el monto coincidente ni el texto del comprobante autorizan pagos.
- El bot responde al cliente que inicia contacto; no se creó un sistema de campañas. Revisar consentimiento, políticas y restricciones de WhatsApp/proveedores y del sector antes de operar. Evolution no equivale por sí mismo a aprobación oficial de WhatsApp ni garantiza que cualquier servicio SMM sea admisible.
- Sin tienda custom, Webpay, entrega automática de archivos/licencias, integración logística ni refunds. Los productos sin proveedor tienen entrega manual auditada.
- El lenguaje libre sirve para descubrir el catálogo y conversar; selección, cotización, pago y entrega permanecen como pasos determinísticos. No hay memoria ilimitada ni negociación automática de descuentos.
- Sin un runtime n8n confirmado e importación real no se declara certificada la compatibilidad del despliegue. Las pruebas locales usan proveedores falsos; no comprueban credenciales, saldo, DNS o acceso de producción.
