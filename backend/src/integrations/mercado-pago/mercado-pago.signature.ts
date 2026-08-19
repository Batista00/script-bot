import { createHmac, timingSafeEqual } from "node:crypto";

interface SignatureParts { ts: string; v1: string }

function parseSignature(value: string | undefined): SignatureParts | null {
  if (value === undefined || value.length === 0 || value.length > 512) return null;
  let ts: string | undefined;
  let v1: string | undefined;
  for (const rawPart of value.split(",")) {
    const separator = rawPart.indexOf("=");
    if (separator <= 0) continue;
    const key = rawPart.slice(0, separator).trim();
    const partValue = rawPart.slice(separator + 1).trim();
    if (key === "ts") {
      if (ts !== undefined) return null;
      ts = partValue;
    }
    if (key === "v1") {
      if (v1 !== undefined) return null;
      v1 = partValue.toLowerCase();
    }
  }
  if (
    ts === undefined || v1 === undefined || !/^[0-9]{1,20}$/.test(ts) ||
    !/^[a-f0-9]{64}$/.test(v1)
  ) {
    return null;
  }
  return { ts, v1 };
}

export function mercadoPagoSignatureManifest(
  dataId: string | undefined,
  requestId: string | undefined,
  timestamp: string | undefined,
): string {
  return [
    dataId === undefined ? "" : `id:${dataId};`,
    requestId === undefined ? "" : `request-id:${requestId};`,
    timestamp === undefined ? "" : `ts:${timestamp};`,
  ].join("");
}

export function verifyMercadoPagoSignature(input: {
  xSignature?: string;
  xRequestId?: string;
  dataId?: string;
  secret: string;
}): boolean {
  const parts = parseSignature(input.xSignature);
  if (!parts) return false;
  const manifest = mercadoPagoSignatureManifest(
    input.dataId,
    input.xRequestId,
    parts.ts,
  );
  const expected = createHmac("sha256", input.secret).update(manifest).digest();
  const received = Buffer.from(parts.v1, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
