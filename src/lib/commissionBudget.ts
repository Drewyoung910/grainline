import { DEFAULT_CURRENCY, formatCurrencyCents } from "./money.ts";

export function formatCommissionBudgetRange(
  minCents: number | null | undefined,
  maxCents: number | null | undefined,
  currency: string | null | undefined = DEFAULT_CURRENCY,
) {
  // Older rows can hold 0, which means no budget was given.
  const min = minCents || null;
  const max = maxCents || null;
  if (min != null && max != null) {
    return `${formatCurrencyCents(min, currency)}\u2013${formatCurrencyCents(max, currency)}`;
  }
  if (min != null) return `From ${formatCurrencyCents(min, currency)}`;
  if (max != null) return `Up to ${formatCurrencyCents(max, currency)}`;
  return null;
}
