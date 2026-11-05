export const BIDI_CONTROL_CHARS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
// Invisible characters, including the soft hyphen (U+00AD), the Mongolian
// vowel separator (U+180E), the word joiner and invisible operators
// (U+2060-U+2064) and the deprecated format characters (U+206A-U+206F).
export const ZERO_WIDTH_CHARS = /[\u00AD\u180E\u200B-\u200D\u2060-\u2064\u206A-\u206F\uFEFF]/g;
// The joiners U+200C/U+200D shape joined emoji and Persian or Indic text, so
// they stay there. Anywhere else they only hide characters (inside a Latin
// word, for example), so they go with the other invisible characters.
const JOINING_SCRIPT =
  "\\p{Script=Arabic}\\p{Script=Syriac}\\p{Script=Devanagari}\\p{Script=Bengali}\\p{Script=Gurmukhi}\\p{Script=Gujarati}\\p{Script=Oriya}\\p{Script=Tamil}\\p{Script=Telugu}\\p{Script=Kannada}\\p{Script=Malayalam}\\p{Script=Sinhala}";
const JOINING_SCRIPT_BEFORE = new RegExp(`[${JOINING_SCRIPT}]$`, "u");
const JOINING_SCRIPT_AFTER = new RegExp(`^[${JOINING_SCRIPT}]`, "u");
const EMOJI_BEFORE_JOINER = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F]$/u;
const EMOJI_AFTER_JOINER = /^\p{Extended_Pictographic}/u;
// Control characters, keeping tab and line breaks. NEL (U+0085) is a line
// break too, but trim() and \s do not know it, so it becomes "\n".
const CONTROL_CHARS = /[\u0000-\u0008\u000E-\u001F\u007F-\u0084\u0086-\u009F]/g;
const NEXT_LINE = /\u0085/g;
// Characters that draw nothing but are not whitespace (Braille blank, Hangul
// fillers). As spaces they get trimmed, so a name made of them is empty.
const BLANK_CHARS = /[\u115F\u1160\u2800\u3164\uFFA0]/g;
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

export function stripInvisibleChars(input: string): string {
  return input.replace(ZERO_WIDTH_CHARS, (char: string, offset: number, text: string) => {
    if (char !== "\u200C" && char !== "\u200D") return "";
    // Two UTF-16 units on each side always hold the neighbouring code point.
    const before = text.slice(Math.max(0, offset - 2), offset);
    const after = text.slice(offset + 1, offset + 3);
    if (JOINING_SCRIPT_BEFORE.test(before) && JOINING_SCRIPT_AFTER.test(after)) return char;
    if (char === "\u200D" && EMOJI_BEFORE_JOINER.test(before) && EMOJI_AFTER_JOINER.test(after)) {
      return char;
    }
    return "";
  });
}

export function normalizeUserText(input: string): string {
  return foldCyrillicConfusables(
    stripInvisibleChars(stripBidiControls(input.normalize("NFKC")))
      .replace(CONTROL_CHARS, "")
      .replace(NEXT_LINE, "\n")
      .replace(BLANK_CHARS, " "),
  );
}
