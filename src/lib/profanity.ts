// src/lib/profanity.ts
// Simple word-list filter using whole-word regex boundaries.
// The slur tier holds a listing or refuses a shop save. The mild tier never
// stops a maker: only blog publishing blocks on it, the rest is log-only.

import { normalizeUserText } from "./sanitize.ts";

export const SLUR_WORDS = [
  // Homophobic slurs
  "fag", "faggot",
  // Ableist slurs
  "retard", "retarded",
  // Racial slurs
  "nigger", "nigga", "chink", "spic", "kike", "wetback", "gook",
  // Telling someone to harm themselves
  "kill yourself",
];

export const MILD_WORDS = [
  // Common profanity
  "fuck", "shit", "damn", "bitch", "bastard", "dick", "cock", "pussy", "cunt", "whore", "slut",
  // Sexual/adult content
  "porn", "pornography", "xxx",
  // Abbreviation that can also be a shop's initials
  "kys",
];

// Plurals follow English rules on purpose: a blanket optional "es" would turn a
// word ending in "c" into a hit on an ordinary kitchen word.
function wordPattern(word: string) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (word.includes(" ")) return escaped;
  if (/[^aeiou]y$/.test(word)) return `${escaped.slice(0, -1)}(?:y|ies)`;
  return /(?:s|x|z|ch|sh)$/.test(word) ? `${escaped}(?:es)?` : `${escaped}s?`;
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

/** True when the text has a slur-tier word. Listing and shop saves use this. */
export function containsSlur(text: string | null | undefined): boolean {
  if (!text) return false;
  return normalizeProfanityText(text).search(SLUR_REGEX) !== -1;
}
