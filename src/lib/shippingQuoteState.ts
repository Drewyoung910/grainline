export const DEFAULT_FALLBACK_SHIPPING_CENTS = 1500;
export const MIN_FALLBACK_SHIPPING_CENTS = 500;

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
  return Math.max(MIN_FALLBACK_SHIPPING_CENTS, Math.round(value));
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
