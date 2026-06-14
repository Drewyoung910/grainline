import { DEFAULT_CURRENCY, formatCurrencyCents } from "./money.ts";

export function formatCommissionBudgetRange(
  minCents: number | null | undefined,
  maxCents: number | null | undefined,
  currency: string | null | undefined = DEFAULT_CURRENCY,
) {
  if (minCents != null && maxCents != null) {
    return `${formatCurrencyCents(minCents, currency)}\u2013${formatCurrencyCents(maxCents, currency)}`;
  }
  if (minCents != null) return `From ${formatCurrencyCents(minCents, currency)}`;
  if (maxCents != null) return `Up to ${formatCurrencyCents(maxCents, currency)}`;
  return null;
}
