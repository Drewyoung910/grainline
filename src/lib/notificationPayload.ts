const BIDI_CONTROL_CHARS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const ZERO_WIDTH_CHARS = /[\u200B-\u200D\uFEFF]/g;
const NULL_BYTES = /\u0000/g;
const CYRILLIC_CONFUSABLES: Record<string, string> = {
  А: "A",
  а: "a",
  В: "B",
  Е: "E",
  е: "e",
  І: "I",
  і: "i",
  К: "K",
  к: "k",
  М: "M",
  Н: "H",
  О: "O",
  о: "o",
  Р: "P",
  р: "p",
  С: "C",
  с: "c",
  Т: "T",
  т: "t",
  У: "Y",
  у: "y",
  Х: "X",
  х: "x",
  Ј: "J",
  ј: "j",
};
const CYRILLIC_CONFUSABLE_CHARS = /[АаВЕеІіКкМНОоРрСсТтУуХхЈј]/g;

function normalizeNotificationText(value: string) {
  return value
    .normalize("NFKC")
    .replace(BIDI_CONTROL_CHARS, "")
    .replace(ZERO_WIDTH_CHARS, "")
    .replace(NULL_BYTES, "")
    .replace(CYRILLIC_CONFUSABLE_CHARS, (char) => CYRILLIC_CONFUSABLES[char] ?? char);
}

export const NOTIFICATION_TITLE_MAX_LENGTH = 200;
export const NOTIFICATION_BODY_MAX_LENGTH = 1000;
export const NOTIFICATION_LINK_MAX_LENGTH = 2048;

export function limitNotificationText(value: string, maxLength: number): string {
  const limit = Math.max(0, Math.floor(maxLength));
  const normalized = normalizeNotificationText(value);
  const chars = Array.from(normalized);
  if (chars.length <= limit) return normalized;
  return chars.slice(0, limit).join("");
}
