export const DEFAULT_CURRENCY = "usd";
export const INVALID_CURRENCY_AMOUNT = "Invalid amount";
const DEFAULT_LOCALE = "en-US";
const ISO_CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MONEY_INPUT_PATTERN = /^([+-])?(?:(\d+)(?:\.(\d{0,2}))?|\.(\d{1,2}))$/;

export function normalizeCurrencyCode(currency: string | null | undefined): string {
  const normalized = (currency ?? DEFAULT_CURRENCY).trim().toUpperCase();
  return ISO_CURRENCY_PATTERN.test(normalized) ? normalized : DEFAULT_CURRENCY.toUpperCase();
}

export function currencyMinorUnitDigits(currency: string | null | undefined = DEFAULT_CURRENCY): number {
  const normalizedCurrency = normalizeCurrencyCode(currency);
  try {
    const formatter = new Intl.NumberFormat(DEFAULT_LOCALE, {
      style: "currency",
      currency: normalizedCurrency,
    });
    return formatter.resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function formatCurrencyMinorUnitAmount(
  amountMinorUnits: number,
  currency: string | null | undefined = DEFAULT_CURRENCY,
): string {
  if (!Number.isFinite(amountMinorUnits)) return INVALID_CURRENCY_AMOUNT;
  const fractionDigits = currencyMinorUnitDigits(currency);
  return (amountMinorUnits / 10 ** fractionDigits).toFixed(fractionDigits);
}

export function formatCurrencyCents(
  cents: number,
  currency: string | null | undefined = DEFAULT_CURRENCY,
  locale: string | undefined = DEFAULT_LOCALE,
): string {
  if (!Number.isFinite(cents)) return INVALID_CURRENCY_AMOUNT;
  const normalizedCurrency = normalizeCurrencyCode(currency);
  try {
    const formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: normalizedCurrency,
    });
    const fractionDigits = currencyMinorUnitDigits(normalizedCurrency);
    const amount = cents / 10 ** fractionDigits;
    return formatter.format(amount);
  } catch {
    const formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: DEFAULT_CURRENCY.toUpperCase(),
    });
    return formatter.format(cents / 100);
  }
}

export function parseMoneyInputToCents(
  input: unknown,
  options: { allowNegative?: boolean } = {},
): number | null {
  const raw =
    typeof input === "number"
      ? String(input)
      : typeof input === "string"
        ? input.trim()
        : "";
  // Empty or non-string/non-number input is "missing", not zero. Callers that
  // allow free items must explicitly accept the numeric 0 result.
  if (!raw) return null;

  const match = MONEY_INPUT_PATTERN.exec(raw);
  if (!match) return null;

  const sign = match[1] ?? "";
  if (sign === "-" && !options.allowNegative) return null;

  const whole = match[2] ?? "0";
  const fractional = (match[3] ?? match[4] ?? "").padEnd(2, "0");
  const cents = BigInt(whole) * 100n + BigInt(fractional || "0");
  const signedCents = sign === "-" ? -cents : cents;

  if (
    signedCents > BigInt(Number.MAX_SAFE_INTEGER) ||
    signedCents < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    return null;
  }

  return Number(signedCents);
}
