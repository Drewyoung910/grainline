// Turns plain words such as "walnut desk under 900" into Browse filters. The
// search panel offers the result as its own row and shows each filter as a
// chip, so the visitor can see what will be applied before choosing it.
import { formatCurrencyCents } from "./money.ts";

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

const PRICE_PHRASE = /\b(?:under|below|less than|up to)\s*\$?\s*(\d[\d,]{1,6})\b|<\s*\$?\s*(\d[\d,]{1,6})\b/i;
const READY_PHRASE = /\b(?:ready to ship|in stock|ships now)\b/i;
const MAX_PRICE_DOLLARS = 500_000;

export type SmartSearch = Readonly<{
  chips: readonly string[];
  href: string;
  // True when the words ask for a price or availability. A plain text search
  // handles those badly, so pressing Enter uses the filters. A wood or a piece
  // alone stays a plain search, because a category filter could hide a match.
  explicitFilter: boolean;
}>;

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
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

  const price = PRICE_PHRASE.exec(term);
  if (price) {
    const dollars = Number((price[1] ?? price[2]).replace(/,/g, ""));
    if (Number.isSafeInteger(dollars) && dollars > 0 && dollars <= MAX_PRICE_DOLLARS) {
      params.set("max", String(dollars));
      chips.push(`Under ${formatCurrencyCents(dollars * 100, "usd").replace(/\.00$/, "")}`);
      explicitFilter = true;
      remaining = remaining.replace(PRICE_PHRASE, " ");
    }
  }

  if (READY_PHRASE.test(term)) {
    params.set("type", "IN_STOCK");
    chips.push("Ready to ship");
    explicitFilter = true;
    remaining = remaining.replace(READY_PHRASE, " ");
  }

  if (chips.length < 2) return null;

  const query = remaining.replace(/\s+/g, " ").trim();
  if (query) params.set("q", query);
  return Object.freeze({ chips: Object.freeze(chips), href: `/browse?${params.toString()}`, explicitFilter });
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
