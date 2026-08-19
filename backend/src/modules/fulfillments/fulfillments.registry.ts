import type { ProviderFulfillmentAdapter } from "./fulfillments.adapter.js";

const providerKeyPattern = /^[a-z0-9][a-z0-9_]{0,63}$/;

export class ProviderFulfillmentRegistry {
  private readonly adapters = new Map<string, ProviderFulfillmentAdapter>();

  constructor(adapters: readonly ProviderFulfillmentAdapter[] = []) {
    for (const adapter of adapters) {
      if (!providerKeyPattern.test(adapter.key)) {
        throw new Error("Invalid provider fulfillment key");
      }
      if (this.adapters.has(adapter.key)) {
        throw new Error(`Duplicate provider fulfillment adapter: ${adapter.key}`);
      }
      this.adapters.set(adapter.key, adapter);
    }
  }

  resolve(providerKey: string): ProviderFulfillmentAdapter | undefined {
    return this.adapters.get(providerKey);
  }
}
