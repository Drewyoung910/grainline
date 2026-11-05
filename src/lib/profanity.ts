// src/lib/profanity.ts
// Simple word-list filter using whole-word regex boundaries.
// The slur tier holds a listing or refuses a shop save. The mild tier never
// stops a maker: only blog publishing blocks on it, the rest is log-only.

import { normalizeUserText } from "./sanitize.ts";

export const SLUR_WORDS = [
  // Racial slurs with no other meaning
  "nigger", "nigga", "wetback",
  // Slurs and a self-harm phrase whose ordinary uses are too rare to justify letting them through
  "faggot", "kike", "kill yourself",
];

export const MILD_WORDS = [
  // Common profanity
  "fuck", "shit", "damn", "bitch", "bastard", "dick", "cock", "pussy", "cunt", "whore", "slut",
  // Sexual/adult content
  "porn", "pornography", "xxx",
  // Abbreviation that can also be a shop's initials
  "kys",
  // Hateful in some uses, but also ordinary English or a trade term.
  // A whole-word match cannot tell which, so these never refuse a save. On a
  // listing, the AI's hateful-language rule judges them in context.
  "fag", "retard", "retarded", "chink", "spic", "gook",
];

function wordPattern(word: string) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return word.includes(" ") ? escaped : `${escaped}s?`;
}

function wordRegex(words: string[]) {
  return new RegExp(`\\b(?:${words.map(wordPattern).join("|")})\\b`, "gi");
}

const PROFANITY_REGEX = wordRegex([...MILD_WORDS, ...SLUR_WORDS]);
const SLUR_REGEX = wordRegex(SLUR_WORDS);

export function normalizeProfanityText(text: string): string {
  return normalizeUserText(text);
}

/**
 * Check text for profanity. Returns which words matched (if any).
 * Does NOT block — callers should log only.
 */
export function containsProfanity(text: string): { flagged: boolean; matches: string[] } {
  if (!text) return { flagged: false, matches: [] };

  const found = normalizeProfanityText(text).match(PROFANITY_REGEX);
  if (!found || found.length === 0) return { flagged: false, matches: [] };

  // Deduplicate and lowercase
  const unique = [...new Set(found.map((m) => m.toLowerCase()))];
  return { flagged: true, matches: unique };
}

export const SHOP_TEXT_SLUR_MESSAGE =
  "This text contains language Grainline does not allow. Please change the wording and save again. If you think this is a mistake, contact support@thegrainline.com.";

/** True when the text has a slur-tier word. Listing and shop saves use this. */
export function containsSlur(text: string | null | undefined): boolean {
  if (!text) return false;
  return normalizeProfanityText(text).search(SLUR_REGEX) !== -1;
}
