// Expected validation failures are replies, not poison messages blocking the inbox.
export function evidenceResponse(body){
  if (body && (typeof body.reviewId==="string" || body.reviewId===null) && typeof body.text==="string") return body;
  const messages={
    INVALID_REQUEST:"No pude leer ese comprobante. Envía una imagen JPG o PNG de hasta 2 MB, no un archivo PDF.",
    INVALID_PAYMENT_EVIDENCE:"El comprobante no tiene un formato o tamaño válido. Envía una imagen JPG o PNG de hasta 2 MB.",
    PAYMENT_REQUIRED:"Selecciona primero transferencia bancaria para tu pedido. Escribe ESTADO o HUMANO si necesitas ayuda.",
    SALES_CHECKOUT_REQUIRED:"Primero selecciona un producto y crea tu pedido. Escribe CATÁLOGO.",
    PAYMENT_NOT_REVIEWABLE:"Este pago no admite otro comprobante pendiente. Escribe ESTADO para consultar el pedido o HUMANO.",
    REVIEW_NOT_CONFIGURED:"La revisión de transferencias todavía no está configurada. Escribe HUMANO para contactar al equipo.",
  };
  const text=messages[body?.error?.code];
  if(!text)throw new Error("EVIDENCE_SERVICE_UNAVAILABLE");
  return {reviewId:null,text};
}
