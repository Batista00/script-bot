# Catálogo, carrito y modalidades de entrega

La naturaleza (`service`, `digital`, `physical`) es independiente del proveedor. La configuración `deliveryConfig` es opcional al crear, editar o importar un producto. Sin ella se conserva el comportamiento anterior. Los servicios SMM siguen siendo servicios, no archivos digitales.

## Panel

- Productos permite buscar por nombre o SKU y editar el vínculo con un servicio sincronizado del proveedor mediante su ID externo. Los pedidos enviados conservan su referencia original.
- La descripción pública del producto se incluye en el resumen de WhatsApp antes del pago. Nunca guardar códigos, enlaces privados ni credenciales en esa descripción.
- Físicos: domicilio, retiro o ambos; dirección del local, tarifa fija, por zona o cotización por el equipo. Los montos usan la unidad mínima de la moneda del negocio. No se marca una entrega física como completada automáticamente.
- En **Ventas por WhatsApp → Conversaciones → Cotizar envío**, owner/admin puede fijar una tarifa para una compra en etapa de entrega y configurada por cotizar. Se guarda usuario/fecha/dirección/tarifa, se envía el resumen completo y se reanuda el bot. El cliente debe confirmar; esta operación no crea ni aprueba un pago. La misma solicitud no genera dos cotizaciones.
- Para digitales propios, guardar primero el producto y volver a Editar → Contenido digital privado. Cargar un enlace HTTPS al archivo/descarga, códigos individuales o ambos. Los archivos se alojan externamente; este formulario no sube binarios. La lista sólo expone etiquetas y disponibilidad, nunca el contenido cifrado.

## Una compra, un cobro

`add_item` conserva la selección; `remove_item` quita un producto. Cada cambio vuelve a calcular un resumen íntegro. Pricing calcula cada línea, Quotes conserva sus snapshots y Orders convierte todas las líneas en un pedido. Un despacho físico idéntico se cobra una vez. No se aceptan precios de OpenAI ni del comprador.

Límites explícitos: hasta diez productos distintos; los carritos con modalidades incompatibles o tarifas distintas requieren coordinación del equipo. Un resumen que no cabe íntegro en el límite de transporte se detiene antes del pago; no se trunca. Catálogos extensos se presentan por lotes de hasta cien productos, sin el antiguo corte a tres.

Un pedido con enlace de pago emitido o comprobante pendiente no se reemplaza desde la conversación: podría cobrarse externamente. Requiere revisión del equipo. Después de pagar, una compra adicional tiene otro pedido/cobro y no modifica la ya pagada.

## Entrega digital propia

`product_digital_assets` guarda enlaces/códigos cifrados con el cifrador existente. Las licencias se reservan atómicamente al confirmar el pedido, antes de generar el pago; dos pedidos no pueden reservar la misma licencia. Se verifica que el contenido cabe en el canal antes de permitir el pago. Las reservas canceladas sin pago aprobado se liberan durante la reconciliación.

Sólo los pedidos con pago verificado generan una notificación de entrega. La cola guarda una referencia, no claves ni enlaces en texto plano. Al reclamarla, el backend comprueba de nuevo el pago y descifra el contenido. Sólo el ACK de envío exitoso permite marcar la entrega completa. Esto confirma aceptación del envío por el canal, no lectura del comprador. El consumidor n8n/Evolution recibe el contenido necesario para enviarlo; conservar las restricciones de acceso y retención de ejecuciones.

## Conversación y despliegue

Typebot Ask Model conserva su Response ID, recibe contexto comercial actual y solicita acciones acotadas. Las FAQ no modifican el estado. Los datos de `input` son valores: una URL que contiene «soporte» no activa una derivación. Una foto no sustituye la URL requerida.

BW 02 abre la sesión comercial actual con prueba inbox/lease y usa exclusivamente su `cs_` en el backend. El bridge distingue `agentVersion:2` del Typebot publicado anterior para permitir un despliegue escalonado. El worker inmediato y recovery conservan la misma secuencia. Regenerar con `node flows/scripts/generate.mjs`; publicar el Typebot actualizado después del backend y BW 02. Nunca copiar credenciales a los exports fuente.

Migraciones nuevas: 17 configuración de entrega, 18 snapshots/costo físico, 19 líneas del carrito, 20 inventario y asignaciones digitales. No activan compras automáticas del proveedor. Las regresiones usan PostgreSQL local y adapters simulados; no sustituyen la prueba real de WhatsApp del propietario.
