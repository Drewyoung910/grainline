export const DEFAULT_CURRENCY = "usd";
const DEFAULT_LOCALE = "en-US";
const ISO_CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MONEY_INPUT_PATTERN = /^([+-])?(?:(\d+)(?:\.(\d{0,2}))?|\.(\d{1,2}))$/;

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
