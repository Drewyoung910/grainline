const MAX_GIFT_WRAPPING_PRICE_CENTS = 10_000;

export function normalizeGiftWrappingProfilePrice(
  offersGiftWrapping: boolean,
  parsedPriceCents: number | null,
) {
  if (!offersGiftWrapping) return null;
  return parsedPriceCents ?? 0;
}

export function resolveGiftWrappingCharge(input: {
  requested: boolean;
  offered: boolean;
  configuredPriceCents: number | null;
}):
  | { ok: true; amountCents: number }
  | { ok: false; error: string } {
  if (!input.requested) return { ok: true, amountCents: 0 };
  if (!input.offered) {
    return { ok: false, error: "This seller does not offer gift wrapping." };
  }
  if (
    input.configuredPriceCents === null
    || !Number.isSafeInteger(input.configuredPriceCents)
    || input.configuredPriceCents < 0
    || input.configuredPriceCents > MAX_GIFT_WRAPPING_PRICE_CENTS
  ) {
    return {
      ok: false,
      error: "Gift wrapping is temporarily unavailable. Please continue without it.",
    };
  }
  return { ok: true, amountCents: input.configuredPriceCents };
}

export function withExclusiveTaxBehavior<
  T extends {
    currency: string;
    unit_amount: number;
    product_data: {
      name: string;
      images?: string[];
      metadata?: Record<string, string>;
      tax_code?: string;
    };
  },
>(priceData: T): T & { tax_behavior: "exclusive" } {
  return { ...priceData, tax_behavior: "exclusive" };
}
