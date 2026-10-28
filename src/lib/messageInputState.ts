import { truncateText } from "./sanitize.ts";
import { codePointLength } from "./textLength.ts";

const MESSAGE_ROUTE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/u;

export function messageRouteId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return MESSAGE_ROUTE_ID_PATTERN.test(value) ? value : null;
}

export function messageSearchQuery(value: unknown): string {
  return truncateText(typeof value === "string" ? value.trim() : "", 200);
}

export function messageSearchQueryIsWithinBounds(value: unknown): value is string {
  return typeof value === "string" && codePointLength(value) <= 200;
}
