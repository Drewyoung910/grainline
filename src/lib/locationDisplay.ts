import { normalizeUsState } from "./usStates.ts";

// Display-only formatting for public city/state lines. Seller state is free
// text ("Tx", "texas") and auto-created metros store full state names
// ("Texas"), while seeded metros use codes ("TX"). Stored values, metro slugs
// and queries are left unchanged; only what is rendered is made consistent.

/** Two-letter code for a known US state code or name; otherwise the trimmed input. */
export function displayUsState(state: string | null | undefined): string {
  const raw = state?.trim() ?? "";
  if (!raw) return "";
  return normalizeUsState(raw) || raw;
}

/** "City, ST" with empty parts dropped; "" when neither part is set. */
export function formatCityState(
  city: string | null | undefined,
  state: string | null | undefined,
): string {
  return [city?.trim() ?? "", displayUsState(state)].filter(Boolean).join(", ");
}
