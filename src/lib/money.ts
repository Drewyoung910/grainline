export const DEFAULT_CURRENCY = "usd";
const DEFAULT_LOCALE = "en-US";
const ISO_CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function normalizeCurrencyCode(currency: string | null | undefined): string {
  const normalized = (currency ?? DEFAULT_CURRENCY).trim().toUpperCase();
  return ISO_CURRENCY_PATTERN.test(normalized) ? normalized : DEFAULT_CURRENCY.toUpperCase();
}

export function formatCurrencyCents(
  cents: number,
  currency: string | null | undefined = DEFAULT_CURRENCY,
  locale: string | undefined = DEFAULT_LOCALE,
): string {
  const amount = Number.isFinite(cents) ? cents / 100 : 0;
  const normalizedCurrency = normalizeCurrencyCode(currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: normalizedCurrency,
    }).format(amount);
  } catch {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: DEFAULT_CURRENCY.toUpperCase(),
    }).format(amount);
  }
}
