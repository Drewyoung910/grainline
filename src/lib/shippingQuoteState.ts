import { SHIPPING_ESTIMATED_DAYS_MAX } from "./shippingRateBounds.ts";

export const DEFAULT_FALLBACK_SHIPPING_CENTS = 1500;
export const MIN_FALLBACK_SHIPPING_CENTS = 500;
export const MAX_FALLBACK_SHIPPING_CENTS = 5000;
export const MAX_PROVIDER_SHIPPING_CENTS = 500_000;
export const PICKUP_RATE_OBJECT_ID = "pickup";
export const SHIPPO_QUOTE_ONLY_RATE_PREFIX = "quote-only:";

export type ShippoQuoteRate = {
  currency?: string | null;
  provider?: string | null;
  carrier?: string | null;
  servicelevel?: { name?: string | null } | null;
  service?: string | null;
  estimated_days?: number | null;
  amount?: number | string | null;
  object_id?: string | null;
};

export function safeFallbackShippingCents(value: number | null | undefined) {
  if (value == null) return DEFAULT_FALLBACK_SHIPPING_CENTS;
  if (!Number.isFinite(value)) return DEFAULT_FALLBACK_SHIPPING_CENTS;
  return Math.min(MAX_FALLBACK_SHIPPING_CENTS, Math.max(MIN_FALLBACK_SHIPPING_CENTS, Math.round(value)));
}

export function safeProviderShippingCents(value: number | string | null | undefined) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > MAX_PROVIDER_SHIPPING_CENTS) {
    return null;
  }
  return cents;
}

export function isPickupRateObjectId(value: string | null | undefined) {
  return value?.trim().toLowerCase() === PICKUP_RATE_OBJECT_ID;
}

export function quoteOnlyRateObjectId(objectId: string | null | undefined) {
  const trimmed = objectId?.trim();
  return trimmed && /^[A-Za-z0-9._:-]{1,255}$/.test(trimmed)
    ? `${SHIPPO_QUOTE_ONLY_RATE_PREFIX}${trimmed}`
    : "";
}

export function isQuoteOnlyRateObjectId(value: string | null | undefined) {
  return typeof value === "string" && value.startsWith(SHIPPO_QUOTE_ONLY_RATE_PREFIX);
}

export function safeShippingEstimatedDays(value: number | null | undefined) {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 1
    && value <= SHIPPING_ESTIMATED_DAYS_MAX
    ? value
    : null;
}

function safeProviderLabelPart(value: string | null | undefined, maxLength: number) {
  return (value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export type NormalizedCheckoutShippoRate = {
  objectId: string;
  amountCents: number;
  carrier: string;
  service: string;
  estDays: number | null;
  label: string;
};

/**
 * Converts provider rates into the exact bounded shape accepted by checkout.
 * Invalid or duplicate provider identities are dropped before they can be
 * displayed or signed, so a rate that appears selectable cannot fail later
 * merely because its provider payload was incomplete.
 */
export function normalizeShippoRatesForCheckout(rates: readonly ShippoQuoteRate[]) {
  const seen = new Set<string>();
  const normalized: NormalizedCheckoutShippoRate[] = [];

  for (const rate of rates) {
    const amountCents = safeProviderShippingCents(rate.amount);
    const objectId = quoteOnlyRateObjectId(rate.object_id);
    const carrier = safeProviderLabelPart(rate.provider || rate.carrier, 100);
    const service = safeProviderLabelPart(rate.servicelevel?.name || rate.service, 100);
    if (amountCents === null || !objectId || !carrier || !service || seen.has(objectId)) {
      continue;
    }

    const estDays = safeShippingEstimatedDays(rate.estimated_days);
    const estimate = estDays === null ? "" : ` (${estDays}d)`;
    const label = `${carrier} ${service}${estimate}`.slice(0, 100);
    seen.add(objectId);
    normalized.push({ objectId, amountCents, carrier, service, estDays, label });
  }

  return normalized;
}

export function preferredAutomaticShippingRate<
  T extends { objectId: string; amountCents: number },
>(rates: readonly T[]): T | null {
  if (rates.length === 0) return null;
  const shippableRates = rates.filter((rate) => !isPickupRateObjectId(rate.objectId));
  const candidates = shippableRates.length > 0 ? shippableRates : rates;
  return candidates.reduce((cheapest, rate) =>
    rate.amountCents < cheapest.amountCents ? rate : cheapest,
  );
}

function normalizeCarrier(value: string) {
  return value.trim().toLowerCase();
}

export function carrierMatchesPreference(rate: ShippoQuoteRate, preferredCarrier: string) {
  const carrier = normalizeCarrier(rate.provider || rate.carrier || "");
  const preferred = normalizeCarrier(preferredCarrier);
  if (!carrier || !preferred) return false;
  return carrier === preferred || carrier.startsWith(`${preferred} `);
}

export function filterShippoRatesForCheckout(input: {
  rates: ShippoQuoteRate[];
  currency: string;
  preferredCarriers?: string[] | null;
}) {
  const currency = input.currency.toLowerCase();
  const preferredCarriers = (input.preferredCarriers ?? []).filter((carrier) => carrier.trim().length > 0);
  const currencyRates = input.rates.filter((rate) => String(rate.currency || "").toLowerCase() === currency);
  const filteredRates =
    preferredCarriers.length === 0
      ? currencyRates
      : currencyRates.filter((rate) =>
          preferredCarriers.some((carrier) => carrierMatchesPreference(rate, carrier)),
        );

  return {
    rates: filteredRates,
    blockedByCarrierPreference: preferredCarriers.length > 0 && currencyRates.length > 0 && filteredRates.length === 0,
  };
}
