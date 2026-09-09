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

function containsTerm(text: string, term: string): boolean {
  return ` ${text} `.includes(` ${normalizeText(term)} `);
}

export function catalogTermGroupsFromText(text: string): string[][] {
  const normalized = normalizeText(text)
    .replace(/\bde(instagram|facebook|tiktok|youtube)\b/g,"de $1")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];

  const groups: string[][] = [];
  const platform = Object.values(platformTerms).find((terms) =>
    terms.some((term) => containsTerm(normalized, term)));
  const service = Object.values(serviceTerms).find((terms) =>
    terms.some((term) => containsTerm(normalized, term)));
  if (platform) groups.push(platform);
  if (service) groups.push(service);
  if (groups.length) return groups;
  const stop=new Set("hola necesito ayuda quiero busco comprar tienes tienen de del el la los las un una para por favor me puedes precio precios cuanto cuesta cotizar servicio servicios producto productos esta estan bien perfecto dale ese esa gracias".split(" "));
  return normalized.split(" ").filter(term=>term.length>2 && !stop.has(term) && !/^\d+$/.test(term)).slice(0,5).map(term=>[term]);
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
  return prices.map((price) => {
    if (price.pricingType === "fixed" && price.fixedPrice !== null) {
      return `${formatMoney(price.fixedPrice, price.currency)} (${range(price)})`;
    }
    if (price.unitPrice !== null) {
      return `${formatMoney(price.unitPrice, price.currency)} por unidad (${range(price)})`;
    }
    return "precio al cotizar";
  }).join("; ");
}

export function mergeCatalogTermGroups(previous:string[][],next:string[][]):string[][] {
  const family=(group:string[])=>Object.values(platformTerms).some(terms=>group.some(t=>terms.includes(t)))?"platform":
    Object.values(serviceTerms).some(terms=>group.some(t=>terms.includes(t)))?"service":null;
  if(!next.length)return previous;
  if(next.some(g=>!family(g)))return next;
  return [...previous.filter(g=>family(g)&&!next.some(n=>family(n)===family(g))),...next];
}

export function changesCatalogPlatform(previous:string[][],next:string[][]):boolean {
  const platforms=Object.values(platformTerms);
  const platform=(groups:string[][])=>platforms.findIndex(terms=>groups.some(g=>g.some(t=>terms.includes(t))));
  const before=platform(previous),after=platform(next);
  return before>=0 && after>=0 && before!==after;
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
  const ranged=choices.map((product,index)=>quantity>=(product.minQuantity??1) &&
    quantity<=(product.maxQuantity??Number.MAX_SAFE_INTEGER) ? index:-1).filter(index=>index>=0);
  if(ranged.length===1)return ranged[0]!;
  if (choices.length === 1 && quantity >= (choices[0]!.minQuantity ?? 1) &&
      quantity <= (choices[0]!.maxQuantity ?? Number.MAX_SAFE_INTEGER)) return 0;
  return -1;
}

export function isConfirmation(text: string): boolean {
  const normalized = normalizeText(text).replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
  return normalized === "si" || normalized.startsWith("si ") ||
    ["confirmo", "confirmar", "correcto", "esta bien", "todo bien", "de acuerdo", "dale"].includes(normalized);
}
