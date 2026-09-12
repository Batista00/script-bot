/**
 * Renderer único de botones nativos de WhatsApp.
 *
 * Evolution (`processButtonMessage`) convierte el texto saliente del chatbot en
 * un mensaje de botones nativo cuando contiene el marcador `[buttons]`; lee
 * `[title]`, `[description]`, `[footer]` y luego cada `[reply]`/`[url]` con sus
 * claves `displayText`/`id`/`url`. Cuando el cliente pulsa, Evolution devuelve
 * al chatbot el `id` interno del botón, no el texto visible.
 *
 * Restricciones reales del formato:
 *  - WhatsApp admite 3 botones por mensaje: TODO menú se pagina, nunca se
 *    degrada a texto ni a lista interactiva.
 *  - El texto del botón es corto (20 caracteres) y de una sola línea.
 *  - El `id` viaja por el canal: solo caracteres seguros y longitud acotada.
 */

export const MAX_WHATSAPP_BUTTONS = 3;
export const MAX_BUTTON_LABEL = 20;
export const MAX_BUTTON_ID = 120;
export const MAX_TITLE = 60;
export const MAX_DESCRIPTION = 1000;
export const MAX_FOOTER = 60;

export interface WhatsAppReplyButton {
  id: string;
  label: string;
}

export interface WhatsAppUrlButton {
  url: string;
  label: string;
}

export interface WhatsAppButtonsInput {
  title: string;
  description: string;
  footer?: string;
  replies?: WhatsAppReplyButton[];
  urlButtons?: WhatsAppUrlButton[];
}

function fail(message: string): never {
  throw new Error(`WhatsApp buttons invalid: ${message}`);
}

/** Una línea, sin marcadores que rompan el parser de Evolution. */
function sanitizeText(value: string, max: number): string {
  return value
    .replace(/\r?\n+/g, " ")
    .replace(/[\[\]]/g, "")
    .trim()
    .slice(0, max);
}

export function sanitizeButtonLabel(value: string, max = MAX_BUTTON_LABEL): string {
  const clean = sanitizeText(value, max);
  if (clean.length === 0) fail("button label is empty");
  return clean;
}

/** Los `id` son semánticos (`menu.buy`, `category:<uuid>`) y se validan aquí. */
export function sanitizeButtonId(value: string): string {
  const clean = value.trim();
  if (clean.length === 0) fail("button id is empty");
  if (clean.length > MAX_BUTTON_ID) fail("button id is too long");
  if (!/^[A-Za-z0-9._:-]+$/.test(clean)) fail(`button id has invalid characters: ${value}`);
  return clean;
}

export function sanitizeButtonUrl(value: string): string {
  const clean = value.trim();
  if (!/^https?:\/\/[^\s]+$/.test(clean)) fail(`button url must be absolute: ${value}`);
  return clean;
}

/**
 * Compone el texto que Typebot debe mostrar y Evolution convertirá en botones.
 * Siempre emite `[title]` seguido de `[description]` porque el parser de
 * Evolution delimita el título con el inicio de la descripción.
 */
export function renderWhatsAppButtons(input: WhatsAppButtonsInput): string {
  const title = sanitizeText(input.title, MAX_TITLE);
  const description = sanitizeText(input.description, MAX_DESCRIPTION);
  if (title.length === 0) fail("title is required");
  if (description.length === 0) fail("description is required");

  const replies = (input.replies ?? []).map((button) => ({
    id: sanitizeButtonId(button.id),
    label: sanitizeButtonLabel(button.label),
  }));
  const urlButtons = (input.urlButtons ?? []).map((button) => ({
    url: sanitizeButtonUrl(button.url),
    label: sanitizeButtonLabel(button.label, 20),
  }));

  const total = replies.length + urlButtons.length;
  if (total === 0) fail("at least one button is required");
  if (total > MAX_WHATSAPP_BUTTONS) {
    fail(`too many buttons (${total}); WhatsApp allows ${MAX_WHATSAPP_BUTTONS}`);
  }
  const seen = new Set<string>();
  for (const button of replies) {
    if (seen.has(button.id)) fail(`duplicated button id ${button.id}`);
    seen.add(button.id);
  }

  // Evolution delimita la descripción con el inicio de `[footer]`: si no se
  // emite, descarta el texto y el cliente sólo recibe el título. Por eso el
  // footer se emite SIEMPRE, aunque vaya vacío.
  const footer = sanitizeText(input.footer ?? "", MAX_FOOTER);
  const lines: string[] = [
    "[buttons]", `[title]${title}`, "", `[description]${description}`, "",
    `[footer]${footer}`, "",
  ];

  for (const button of replies) {
    lines.push("[reply]", `displayText: ${button.label}`, `id: ${button.id}`, "");
  }
  for (const button of urlButtons) {
    lines.push("[url]", `displayText: ${button.label}`, `url: ${button.url}`, "");
  }
  return lines.join("\n").trimEnd();
}

/** Importe compacto para etiquetas de botón: "$4.990". */
export function formatCompactAmount(amount: number): string {
  return `$${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(amount)}`;
}

/** Etiqueta de botón de venta: nombre corto y, si cabe, el precio. */
export function commercialButtonLabel(name: string, amount: number | null): string {
  const clean = sanitizeText(name, MAX_BUTTON_LABEL);
  if (amount === null || amount <= 0) return clean;
  const price = formatCompactAmount(amount);
  const room = MAX_BUTTON_LABEL - price.length - 1;
  if (room < 6) return clean;
  return `${sanitizeText(name, room)} ${price}`;
}

/**
 * Menú enumerado. Es el respaldo cuando el cliente de WhatsApp no puede mostrar
 * botones nativos: el backend conserva los ids y resuelve el número que responde
 * el cliente, así que la lógica comercial sigue siendo suya.
 */
export function renderNumberedMenu(
  text: string,
  options: Array<{ id: string; label: string }>,
): string {
  const lines = options.map((option, index) => `${index + 1}. ${option.label}`);
  return `${text}\n\n${lines.join("\n")}\n\nResponde con el número de la opción.`;
}

/** Texto plano sin botones: un solo mensaje, una sola idea. */
export function renderPlainMessage(text: string): string {
  return text.trim();
}

export interface PaginatedButtons<T> {
  visible: T[];
  hasNext: boolean;
  hasPrevious: boolean;
}

/**
 * Pagina respetando el hueco que dejan los botones de navegación: se reserva
 * uno para `navigation.next`/`navigation.previous` cuando hace falta, de modo
 * que nunca se envía un payload con más botones de los permitidos.
 */
export function paginate<T>(
  items: T[],
  page: number,
  options: { navigationSlots?: number; extraSlots?: number } = {},
): PaginatedButtons<T> {
  const navigationSlots = options.navigationSlots ?? 1;
  const extraSlots = options.extraSlots ?? 0;
  const pageSize = Math.max(1, MAX_WHATSAPP_BUTTONS - extraSlots - navigationSlots);
  const safePage = Math.max(0, Math.floor(page));
  const start = safePage * pageSize;
  const visible = items.slice(start, start + pageSize);
  const hasNext = items.length > start + visible.length;
  const hasPrevious = safePage > 0;
  return { visible, hasNext, hasPrevious };
}

/** Capacidad efectiva de contenido para una página con huecos reservados. */
export function pageCapacity(options: { navigationSlots?: number; extraSlots?: number } = {}): number {
  const navigationSlots = options.navigationSlots ?? 1;
  const extraSlots = options.extraSlots ?? 0;
  return Math.max(1, MAX_WHATSAPP_BUTTONS - extraSlots - navigationSlots);
}
