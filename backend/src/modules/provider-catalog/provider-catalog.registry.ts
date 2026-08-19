import type { ProviderCatalogAdapter } from "./provider-catalog.adapter.js";

const providerKeyPattern = /^[a-z0-9][a-z0-9_]{0,63}$/;

export function normalizeCatalogProviderKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!providerKeyPattern.test(normalized)) throw new Error("Invalid provider catalog key");
  return normalized;
}

export class ProviderCatalogRegistry {
  private readonly adapters = new Map<string, ProviderCatalogAdapter>();

  constructor(adapters: readonly ProviderCatalogAdapter[] = []) {
    for (const adapter of adapters) {
      const key = normalizeCatalogProviderKey(adapter.key);
      if (this.adapters.has(key)) throw new Error(`Duplicate provider catalog: ${key}`);
      this.adapters.set(key, adapter);
    }
  }

  resolve(providerKey: string): ProviderCatalogAdapter | undefined {
    return this.adapters.get(normalizeCatalogProviderKey(providerKey));
  }
}
