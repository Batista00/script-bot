import type { NormalizedInboundMessage } from "./whatsapp.types.js";

export const maximumBodyLength = 8192;
export const maximumMediaUrlLength = 2048;
export const maximumNameLength = 120;
export const maximumProviderErrorLength = 1000;

const supportedJidDomains = new Set(["s.whatsapp.net", "c.us"]);
const phonePattern = /^[0-9]{1,32}$/;

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) return null;
  return normalized;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/**
 * Extracts the customer phone number from an Evolution `remoteJid`. Accepts
 * `@s.whatsapp.net` and `@c.us`, drops the `:NN` device suffix and refuses
 * group/broadcast threads that cannot be mapped to a customer.
 */
export function normalizePhoneFromJid(remoteJid: string): string | null {
  const atIndex = remoteJid.indexOf("@");
  const localPart = atIndex === -1 ? remoteJid : remoteJid.slice(0, atIndex);
  const domain = atIndex === -1 ? "" : remoteJid.slice(atIndex + 1).toLowerCase();
  if (domain !== "" && !supportedJidDomains.has(domain)) return null;
  const withoutDevice = localPart.split(":")[0] ?? "";
  if (!phonePattern.test(withoutDevice)) return null;
  return withoutDevice;
}

function isMessageUpsertEvent(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== "string") return false;
  return value.trim().toLowerCase().replace(/_/g, ".") === "messages.upsert";
}

function isProtocolMessage(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "protocolmessage";
}

function extractText(message: Record<string, unknown>): string | null {
  const conversation = message.conversation;
  if (typeof conversation === "string" && conversation.trim().length > 0) {
    return truncate(conversation, maximumBodyLength);
  }
  const extended = record(message.extendedTextMessage);
  const extendedText = extended?.text;
  if (typeof extendedText === "string" && extendedText.trim().length > 0) {
    return truncate(extendedText, maximumBodyLength);
  }
  return null;
}

const mediaKinds = [
  ["imageMessage", "image"],
  ["audioMessage", "audio"],
  ["documentMessage", "document"],
] as const;

function extractMedia(message: Record<string, unknown>): {
  mediaType: string | null;
  mediaUrl: string | null;
} {
  for (const [key, kind] of mediaKinds) {
    const media = record(message[key]);
    if (!media) continue;
    return { mediaType: kind, mediaUrl: nonEmptyString(media.url, maximumMediaUrlLength) };
  }
  return { mediaType: null, mediaUrl: null };
}

/**
 * Normalizes a raw Evolution `messages.upsert` payload. Returns `null` for
 * everything the channel must ignore: events other than message upserts,
 * protocol messages, messages sent by the business itself and threads that do
 * not identify a phone number.
 */
export function normalizeEvolutionInbound(payload: unknown): NormalizedInboundMessage | null {
  const body = record(payload);
  if (!body) return null;
  if (!isMessageUpsertEvent(body.event)) return null;
  const data = record(body.data);
  if (!data) return null;
  const key = record(data.key);
  if (!key) return null;
  if (key.fromMe === true || key.fromMe === "true") return null;
  if (isProtocolMessage(data.messageType)) return null;
  const remoteJid = typeof key.remoteJid === "string" ? key.remoteJid.trim() : "";
  if (remoteJid.length === 0 || remoteJid.length > 200) return null;
  const phone = normalizePhoneFromJid(remoteJid);
  if (phone === null) return null;
  const message = record(data.message) ?? {};
  const media = extractMedia(message);
  return {
    phone,
    externalThreadId: remoteJid,
    externalMessageId: nonEmptyString(key.id, 200),
    name: nonEmptyString(data.pushName, maximumNameLength),
    text: extractText(message),
    mediaType: media.mediaType,
    mediaUrl: media.mediaUrl,
  };
}
