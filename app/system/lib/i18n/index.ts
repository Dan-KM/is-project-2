import { en, type MessageKey } from "./en";

export type { MessageKey };
export type MessageParams = Record<string, string | number>;

// Only English for now. Adding Swahili = add sw.ts with the same keys and pick
// the dictionary from the user's preference here.
const dictionary: Record<MessageKey, string> = en;

/** Returns true when a string is one of our message keys (used for Zod messages). */
export function isMessageKey(value: string): value is MessageKey {
  return value in dictionary;
}

/**
 * Pack a key and its params into one string, for places that only carry a
 * string (e.g. Zod issue messages). t() unpacks it: "validation.range|{"min":0}".
 */
export function encodeMessage(key: MessageKey, params: MessageParams): string {
  return `${key}|${JSON.stringify(params)}`;
}

/** Translate a key and fill {placeholders}. Unknown keys fall back to the raw text. */
export function t(key: MessageKey | string, params?: MessageParams): string {
  const sep = key.indexOf("|");
  if (sep > 0 && !params) {
    try {
      return t(key.slice(0, sep), JSON.parse(key.slice(sep + 1)) as MessageParams);
    } catch {
      // not an encoded message; fall through and show it as is
    }
  }
  const template = isMessageKey(key) ? dictionary[key] : key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
