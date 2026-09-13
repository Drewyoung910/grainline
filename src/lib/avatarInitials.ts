import { sanitizeUserName } from "./sanitize";

export function avatarInitial(name: string | null | undefined, fallback = "A") {
  const cleaned = sanitizeUserName(name ?? "", 80) || fallback;
  return Array.from(cleaned)[0]?.toUpperCase() ?? fallback;
}

export function avatarInitials(name: string | null | undefined, fallback = "A", maxParts = 2) {
  const cleaned = sanitizeUserName(name ?? "", 120);
  const parts = cleaned
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxParts)
    .map((part) => Array.from(part)[0]?.toUpperCase() ?? "")
    .join("");
  return parts || avatarInitial(fallback, fallback);
}
