// src/lib/profanity.ts
// Simple word-list profanity filter using whole-word regex boundaries.
// Log-only for now — does not block submissions.

const BLOCKED_WORDS = [
  // Common profanity
  "fuck", "shit", "damn", "bitch", "bastard", "dick", "cock", "pussy", "cunt",
  "whore", "slut",
  // Homophobic slurs
  "fag", "faggot",
  // Ableist slurs
  "retard", "retarded",
  // Racial slurs
  "nigger", "nigga", "chink", "spic", "kike", "wetback", "gook",
  // Sexual/adult content
  "porn", "pornography", "xxx",
  // Harassment phrases
  "kill yourself", "kys",
];

// Build a single regex with word boundaries for all terms.
// Phrases with spaces (e.g. "kill yourself") are matched literally.
// The \b boundaries prevent false positives like "class" matching "ass".
const PROFANITY_REGEX = new RegExp(
  BLOCKED_WORDS.map((w) => `\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).join("|"),
  "gi"
);

/**
 * Check text for profanity. Returns which words matched (if any).
 * Does NOT block — callers should log only.
 */
export function containsProfanity(text: string): { flagged: boolean; matches: string[] } {
  if (!text) return { flagged: false, matches: [] };

  const found = text.match(PROFANITY_REGEX);
  if (!found || found.length === 0) return { flagged: false, matches: [] };

  // Deduplicate and lowercase
  const unique = [...new Set(found.map((m) => m.toLowerCase()))];
  return { flagged: true, matches: unique };
}
