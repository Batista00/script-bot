import { z } from "zod";

// Untrusted OCR observations only: no approval, confidence threshold or action fields.
export const evidenceAnalysisSchema=z.object({
  amount:z.string().regex(/^[0-9]{1,16}(\.[0-9]{1,2})?$/).nullable(),
  currency:z.string().regex(/^[A-Z]{3}$/).nullable(),
  recipient:z.string().max(200).nullable(),
  bankReference:z.string().max(128).nullable(),
  observations:z.string().max(1000),
}).strict();
export type EvidenceAnalysis=z.infer<typeof evidenceAnalysisSchema>;

export function describeEvidenceAnalysis(analysis:EvidenceAnalysis,amount:number,currency:string):string {
  // CLP uses whole pesos. Other currencies deliberately require manual interpretation.
  const comparable=currency==="CLP" && analysis.currency==="CLP" && analysis.amount!==null && /^\d+$/.test(analysis.amount);
  const match=comparable && BigInt(analysis.amount!)===BigInt(amount);
  return `LECTURA AUTOMÁTICA NO VERIFICADA — NO APRUEBA PAGOS\n`+
    `Esperado: ${amount} ${currency}\nLeído: ${analysis.amount ?? "ilegible"} ${analysis.currency ?? "desconocida"}\n`+
    `Comparación: ${comparable ? (match ? "coincide numéricamente; NO prueba abono" : "monto diferente") : "requiere revisión humana"}\n`+
    `Destinatario leído: ${analysis.recipient ?? "ilegible"}\nReferencia leída: ${analysis.bankReference ?? "ilegible"}\n`+
    `Observaciones (texto no confiable): ${analysis.observations}\nVerifica siempre tu cuenta bancaria y el comprobante original.`;
}
