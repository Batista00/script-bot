import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import {
  mercadoPagoSignatureManifest,
  verifyMercadoPagoSignature,
} from "../src/integrations/mercado-pago/mercado-pago.signature.js";

const fixture = {
  dataId: "123456789",
  requestId: "req-fixture-1",
  timestamp: "1704908010",
  secret: "fixture-secret",
  expectedHash: "38aacacd8e40885b372272497c4a43f0cc01ebee34a55458bcde82c680a5921e",
};

test("Mercado Pago HMAC fixture matches the official manifest algorithm", () => {
  const manifest = mercadoPagoSignatureManifest(
    fixture.dataId,
    fixture.requestId,
    fixture.timestamp,
  );
  assert.equal(manifest, "id:123456789;request-id:req-fixture-1;ts:1704908010;");
  const independentlyCalculated = createHmac("sha256", fixture.secret)
    .update(manifest)
    .digest("hex");
  assert.equal(independentlyCalculated, fixture.expectedHash);
  assert.equal(verifyMercadoPagoSignature({
    xSignature: `ts=${fixture.timestamp},v1=${fixture.expectedHash}`,
    xRequestId: fixture.requestId,
    dataId: fixture.dataId,
    secret: fixture.secret,
  }), true);
});

test("signature is invalidated by changing any signed component", () => {
  const xSignature = `ts=${fixture.timestamp},v1=${fixture.expectedHash}`;
  for (const input of [
    { xSignature, xRequestId: fixture.requestId, dataId: "123456788", secret: fixture.secret },
    { xSignature, xRequestId: "req-modified", dataId: fixture.dataId, secret: fixture.secret },
    {
      xSignature: `ts=1704908011,v1=${fixture.expectedHash}`,
      xRequestId: fixture.requestId,
      dataId: fixture.dataId,
      secret: fixture.secret,
    },
    {
      xSignature: `ts=${fixture.timestamp},v1=${"0".repeat(64)}`,
      xRequestId: fixture.requestId,
      dataId: fixture.dataId,
      secret: fixture.secret,
    },
  ]) {
    assert.equal(verifyMercadoPagoSignature(input), false);
  }
});

test("missing request id is omitted from the signed manifest", () => {
  const manifest = `id:${fixture.dataId};ts:${fixture.timestamp};`;
  const hash = createHmac("sha256", fixture.secret).update(manifest).digest("hex");
  assert.equal(mercadoPagoSignatureManifest(
    fixture.dataId, undefined, fixture.timestamp,
  ), manifest);
  assert.equal(verifyMercadoPagoSignature({
    xSignature: `ts=${fixture.timestamp},v1=${hash}`,
    dataId: fixture.dataId,
    secret: fixture.secret,
  }), true);
});
