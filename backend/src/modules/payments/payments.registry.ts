import type { PaymentProvider } from "./payments.provider.js";

const providerKeyPattern = /^[a-z][a-z0-9_]{0,63}$/;

export function normalizeProviderKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!providerKeyPattern.test(normalized)) throw new Error("Invalid payment provider key");
  return normalized;
}

export class PaymentProviderRegistry {
  private readonly providers = new Map<string, PaymentProvider>();

  constructor(providers: readonly PaymentProvider[] = []) {
    for (const provider of providers) {
      const key = normalizeProviderKey(provider.key);
      if (this.providers.has(key)) throw new Error(`Duplicate payment provider: ${key}`);
      this.providers.set(key, provider);
    }
  }

  resolve(key: string): PaymentProvider | null {
    return this.providers.get(normalizeProviderKey(key)) ?? null;
  }
}
