// Turns plain words such as "walnut desk under 900" into Browse filters. The
// search panel offers the result as its own row and shows each filter as a
// chip, so the visitor can see what will be applied before choosing it.
import { DEFAULT_CURRENCY, formatCurrencyCents } from "./money.ts";

const WOODS = ["walnut", "oak", "maple", "cherry", "hickory", "cedar", "pine", "ash", "mahogany", "teak"];

// First match wins, so more specific phrases come before their general words.
const CATEGORY_WORDS: ReadonlyArray<readonly [value: string, label: string, pattern: RegExp]> = [
  ["KITCHEN", "Kitchen", /\b(cutting boards?|charcuterie|butcher blocks?|spoons?|bowls?|kitchen)\b/i],
  ["TOOLS", "Home & Office", /\b(laptop stands?|desk organi[sz]ers?|organi[sz]ers?|office)\b/i],
  ["JEWELRY", "Jewelry", /\b(jewelry|jewellery|earrings?|necklaces?|bracelets?)\b/i],
  ["TOYS", "Toys", /\b(toys?|puzzles?|building blocks?)\b/i],
  ["OUTDOOR", "Outdoor", /\b(outdoor|patio|garden|planters?|adirondack)\b/i],
  ["ART", "Art", /\b(wall art|sculptures?|carvings?)\b/i],
  ["DECOR", "Decor", /\b(decor|picture frames?|frames?|signs?|mirrors?|candle holders?)\b/i],
  ["STORAGE", "Gifts", /\b(gifts?|presents?)\b/i],
  ["FURNITURE", "Furniture", /\b(tables?|desks?|cabinets?|credenzas?|benche?s?|shelf|shelves|bookcases?|bookshelf|bookshelves|dressers?|chairs?|stools?|beds?|nightstands?|consoles?|booths?)\b/i],
];

const PRICE_PHRASE = /(?:\b(?:under|below|less than|up to)\s*|<\s*)(\$?)\s*(\d{1,3}(?:,\d{3})+|\d{1,7})(\.\d{1,2})?(?!\d)/i;
// "under 30 inches" and "under 24 x 36" describe a size, not a budget.
const MEASUREMENT_AFTER =
  /^\s*(?:"|''|\u2032|\u2033|x\b|\u00d7|in\b|inch(?:es)?\b|ft\b|foot\b|feet\b|cm\b|mm\b|met(?:er|re)s?\b|lbs?\b|pounds?\b|kg\b|oz\b|ounces?\b|years?\b|yrs?\b|months?\b|weeks?\b|days?\b|wide\b|tall\b|long\b|deep\b|high\b|sq\b|square\b)/i;
// "toys for kids under 10" is an age. Only small numbers can be one.
const AGE_WORDS = /\b(?:kids?|child|children|toddlers?|bab(?:y|ies)|boys?|girls?|teens?|ages?|aged)\b/i;
const OLDEST_AGE_PHRASE = 18;
// A bare number is a budget only where a budget normally ends the phrase. "up to 10
// people", "under 24x36" and "up to 6 seats" describe the piece, and Enter shows no
// chips, so a wrong guess there would silently hide nearly everything.
const BUDGET_ENDS_HERE = /^\s*(?:$|[,.;:!?)]|dollars?\b|bucks?\b|usd\b|or less\b|ready to ship\b|in stock\b|ships now\b)/i;
const READY_PHRASE = /\b(?:ready to ship|in stock|ships now)\b/i;
const MAX_PRICE_DOLLARS = 500_000;

export type SmartSearch = Readonly<{
  chips: readonly string[];
  // Where the row goes. The visitor sees its chips, category included, before
  // choosing it.
  href: string;
  // True when the words ask for a price or availability. A plain text search
  // handles those badly, so pressing Enter uses the filters. A wood or a piece
  // alone stays a plain search, because a category filter could hide a match.
  explicitFilter: boolean;
  // Where Enter goes. Enter shows no chips, so it applies only what was asked
  // for: "kitchen table under 500" must not hide tables filed under Furniture.
  enterHref: string;
}>;

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// The budget in whole dollars, or null when the words only look like one.
function budgetIn(term: string): { dollars: number; phrase: string; certain: boolean } | null {
  const match = PRICE_PHRASE.exec(term);
  if (!match) return null;
  const hasDollarSign = match[1] === "$";
  const after = term.slice(match.index + match[0].length);
  if (!hasDollarSign && MEASUREMENT_AFTER.test(after)) return null;
  const dollars = Math.ceil(Number(match[2].replace(/,/g, "") + (match[3] ?? "")));
  if (!Number.isSafeInteger(dollars) || dollars <= 0 || dollars > MAX_PRICE_DOLLARS) return null;
  if (!hasDollarSign && dollars <= OLDEST_AGE_PHRASE && AGE_WORDS.test(term)) return null;
  return { dollars, phrase: match[0], certain: hasDollarSign || BUDGET_ENDS_HERE.test(after) };
}

export function parseSmartSearch(raw: string): SmartSearch | null {
  const term = raw.replace(/\s+/g, " ").trim();
  if (term.split(" ").length < 2) return null;

  const params = new URLSearchParams();
  const chips: string[] = [];
  let remaining = term;
  let explicitFilter = false;

  const wood = WOODS.find((candidate) => new RegExp(`\\b${candidate}\\b`, "i").test(term));
  if (wood) chips.push(titleCase(wood));

  const category = CATEGORY_WORDS.find(([, , pattern]) => pattern.test(term));
  if (category) {
    params.set("category", category[0]);
    chips.push(category[1]);
  }

  const budget = budgetIn(term);
  if (budget) {
    params.set("max", String(budget.dollars));
    chips.push(`Under ${formatCurrencyCents(budget.dollars * 100, DEFAULT_CURRENCY).replace(/\.00$/, "")}`);
    if (budget.certain) explicitFilter = true;
    remaining = remaining.replace(budget.phrase, " ");
  }

  if (READY_PHRASE.test(term)) {
    params.set("type", "IN_STOCK");
    chips.push("Ready to ship");
    explicitFilter = true;
    remaining = remaining.replace(READY_PHRASE, " ");
  }

  if (chips.length < 2) return null;

  // Taking a phrase out can strand the punctuation that followed it.
  const query = remaining.replace(/(^|\s)[,;:.]+(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
  if (query) params.set("q", query);
  const enterParams = new URLSearchParams(params);
  enterParams.delete("category");
  if (budget && !budget.certain) {
    // The row shows its guess as a chip. Enter shows nothing, so it keeps the words.
    enterParams.delete("max");
    enterParams.set("q", term.replace(READY_PHRASE, " ").replace(/\s+/g, " ").trim());
  }
  return Object.freeze({
    chips: Object.freeze(chips),
    href: `/browse?${params.toString()}`,
    explicitFilter,
    enterHref: `/browse?${enterParams.toString()}`,
  });
}

export type HighlightPart = Readonly<{ text: string; match: boolean }>;

// Splits a label around the words the visitor typed, for bold matches.
export function highlightParts(text: string, query: string): HighlightPart[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length >= 2)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (words.length === 0) return [{ text, match: false }];
  const pattern = new RegExp(`(${words.join("|")})`, "giu");
  return text
    .split(pattern)
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, match: words.some((word) => new RegExp(`^${word}$`, "iu").test(part)) }));
}

// Whether a "/" press should move focus to the search box. Typing "/" in a
// field or using it with a browser shortcut must keep working.
export function isSearchShortcut(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  target: EventTarget | null;
}): boolean {
  if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return false;
  const target = event.target as { tagName?: unknown; isContentEditable?: unknown } | null;
  const tag = typeof target?.tagName === "string" ? target.tagName.toUpperCase() : "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return false;
  return target?.isContentEditable !== true;
}
