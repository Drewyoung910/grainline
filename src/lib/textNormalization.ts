export const BIDI_CONTROL_CHARS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
export const ZERO_WIDTH_CHARS = /[\u200B-\u200D\uFEFF]/g;
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

export function stripBidiControls(input: string): string {
  return input.replace(BIDI_CONTROL_CHARS, "");
}

export function foldCyrillicConfusables(input: string): string {
  return input.replace(CYRILLIC_CONFUSABLE_CHARS, (char) => CYRILLIC_CONFUSABLES[char] ?? char);
}

export function normalizeUserText(input: string): string {
  return foldCyrillicConfusables(
    stripBidiControls(input.normalize("NFKC"))
      .replace(ZERO_WIDTH_CHARS, "")
      .replace(NULL_BYTES, ""),
  );
}
