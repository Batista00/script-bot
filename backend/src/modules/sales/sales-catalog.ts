import type { AiInterpretation } from "../ai-orchestrator/ai-orchestrator.types.js";
import type { BotPriceDto, BotProductDto } from "../bot-gateway/bot-gateway.types.js";

export function normalizeText(text: string): string {
  return text.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

const platformTerms: Record<string, string[]> = {
  instagram: ["instagram"],
  facebook: ["facebook"],
  youtube: ["youtube"],
  tiktok: ["tiktok", "tik tok"],
};

const serviceTerms: Record<string, string[]> = {
  followers: ["seguidores", "seguidor", "followers", "follower", "suscriptores", "suscriptor"],
  likes: ["likes", "like", "me gusta"],
  views: ["views", "view", "vistas", "vista", "reproducciones", "reproduccion"],
  comments: ["comentarios", "comentario", "comments", "comment"],
  live_views: ["live views", "live view", "espectadores", "transmision en vivo", "directo"],
};

function safeTerms(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 1))];
}

export function catalogTermGroups(value: AiInterpretation): string[][] {
  const groups: string[][] = [];
  if (value.entities.platform) groups.push(platformTerms[value.entities.platform] ?? [value.entities.platform]);
  if (value.entities.service) groups.push(serviceTerms[value.entities.service] ?? [value.entities.service]);
  if (!value.entities.platform || !value.entities.service) {
    for (const term of safeTerms(value.entities.searchTerms).flatMap((item) => item.split(/\s+/))) {
      if (!groups.some((group) => group.includes(term))) groups.push([term]);
    }
  }
  return groups.slice(0, 6);
}

export function formatMoney(amount: number, currency: string): string {
  return `${new Intl.NumberFormat("es-CL").format(amount)} ${currency}`;
}

function range(price: BotPriceDto): string {
  if (price.minQuantity !== null && price.maxQuantity !== null) {
    return price.minQuantity === price.maxQuantity
      ? `${price.minQuantity}` : `${price.minQuantity}–${price.maxQuantity}`;
  }
  if (price.minQuantity !== null) return `desde ${price.minQuantity}`;
  if (price.maxQuantity !== null) return `hasta ${price.maxQuantity}`;
  return "cantidad configurable";
}

export function priceSummary(prices: BotPriceDto[]): string {
  return prices.slice(0, 3).map((price) => {
    if (price.pricingType === "fixed" && price.fixedPrice !== null) {
      return `${formatMoney(price.fixedPrice, price.currency)} (${range(price)})`;
    }
    if (price.unitPrice !== null) {
      return `${formatMoney(price.unitPrice, price.currency)} por unidad (${range(price)})`;
    }
    return "precio al cotizar";
  }).join("; ");
}

export function exactFixedPrices(prices: BotPriceDto[]): BotPriceDto[] {
  return prices.filter((price) => price.pricingType === "fixed" && price.fixedPrice !== null &&
    price.minQuantity !== null && price.minQuantity === price.maxQuantity);
}

export function quantityFromText(text: string): number | null {
  const normalized = text.trim().toLowerCase();
  const words: Record<string, number> = {
    quinientos: 500, mil: 1000, "dos mil": 2000, "tres mil": 3000,
    "cuatro mil": 4000, "cinco mil": 5000, "diez mil": 10000,
  };
  for (const [label, quantity] of Object.entries(words).sort(([left], [right]) => right.length - left.length)) {
    if (normalized.includes(label)) return quantity;
  }
  const match = normalized.match(/(?:^|\D)(\d{1,3}(?:[.\s]\d{3})+|\d{2,})(?:\D|$)/);
  if (!match?.[1]) return null;
  const quantity = Number(match[1].replace(/[.\s]/g, ""));
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
}

export function offeredQuantityIndex(
  choices: BotProductDto[],
  quantities: Array<number | null>,
  quantity: number,
): number {
  const exact = quantities.map((value, index) => value === quantity ? index : -1).filter((index) => index >= 0);
  if (exact.length === 1) return exact[0]!;
  if (choices.length === 1 && quantity >= (choices[0]!.minQuantity ?? 1) &&
      quantity <= (choices[0]!.maxQuantity ?? Number.MAX_SAFE_INTEGER)) return 0;
  return -1;
}

export function isConfirmation(text: string): boolean {
  const normalized = normalizeText(text).replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
  return normalized === "si" || normalized.startsWith("si ") ||
    ["confirmo", "confirmar", "correcto", "esta bien", "todo bien", "de acuerdo"].includes(normalized);
}
