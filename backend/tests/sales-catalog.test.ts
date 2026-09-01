import assert from "node:assert/strict";
import { test } from "node:test";

import type { AiInterpretation } from "../src/modules/ai-orchestrator/ai-orchestrator.types.js";
import {
  catalogTermGroups, catalogTermGroupsFromText, isConfirmation, quantityFromText,
} from "../src/modules/sales/sales-catalog.js";

function interpretation(overrides: Partial<AiInterpretation["entities"]>): AiInterpretation {
  return {
    intent: "buy_product",
    confidence: 0.95,
    entities: {
      platform: null,
      service: null,
      quantity: null,
      urls: [],
      paymentMethod: null,
      searchTerms: [],
      ...overrides,
    },
  };
}

test("catalog search expands known services without depending on a fixed product list", () => {
  assert.deepEqual(catalogTermGroups(interpretation({
    platform: "instagram", service: "followers", searchTerms: ["instagram", "seguidores"],
  })), [
    ["instagram"],
    ["seguidores", "seguidor", "followers", "follower", "suscriptores", "suscriptor"],
  ]);
  assert.deepEqual(catalogTermGroups(interpretation({ searchTerms: ["spotify", "reproducciones premium"] })), [
    ["spotify"], ["reproducciones"], ["premium"],
  ]);
});

test("natural catalog requests are recognized without an AI provider", () => {
  assert.deepEqual(catalogTermGroupsFromText("Busco seguidores de Instagram"), [
    ["instagram"],
    ["seguidores", "seguidor", "followers", "follower", "suscriptores", "suscriptor"],
  ]);
  assert.deepEqual(catalogTermGroupsFromText("¿Tienen likes para Tik Tok?"), [
    ["tiktok", "tik tok"], ["likes", "like", "me gusta"],
  ]);
  assert.deepEqual(catalogTermGroupsFromText("hola, necesito ayuda"), []);
});
test("natural quantities and confirmations used by WhatsApp are recognized", () => {
  assert.equal(quantityFromText("quiero los 1.000"), 1000);
  assert.equal(quantityFromText("necesito dos mil"), 2000);
  assert.equal(isConfirmation("Sí, están bien"), true);
  assert.equal(isConfirmation("no, quiero cambiarlo"), false);
});
