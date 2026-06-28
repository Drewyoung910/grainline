// src/lib/shippo.ts
import { fetchWithTimeout } from "./fetchWithTimeout.ts";
import { readResponseTextWithTimeout } from "./responseText.ts";
import { requiredProductionEnv } from "./env.ts";
import { shippoProviderErrorMessage } from "./shippoErrorSanitize.ts";
import { DEFAULT_CURRENCY, normalizeCurrencyCode } from "./money.ts";
import { safeProviderShippingCents } from "./shippingQuoteState.ts";

const SHIPPO_API_KEY = requiredProductionEnv("SHIPPO_API_KEY");
const SHIPPO_BASE = "https://api.goshippo.com";
const ISO_CURRENCY_CODE = /^[A-Z]{3}$/i;

type Address = {
  name?: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string; // "US"
};

type Parcel = {
  weight: { value: number; unit: "g" };
  length?: string;
  width?: string;
  height?: string;
};

type ShippoRate = {
  object_id?: string | null;
  provider?: string | null;
  servicelevel?: { name?: string | null } | null;
  amount?: string | number | null;
  currency?: string | null;
  est_days?: number | null;
};

export type NormalizedShippoRate = {
  objectId: string;
  provider?: string | null;
  servicelevel_name?: string | null;
  amount: number;
  currency: string;
  est_days?: number | null;
};

export function normalizeShippoRateCurrency(value: unknown, fallback = DEFAULT_CURRENCY) {
  if (value == null || String(value).trim() === "") {
    return normalizeCurrencyCode(fallback).toLowerCase();
  }
  const raw = String(value).trim();
  return ISO_CURRENCY_CODE.test(raw) ? raw.toLowerCase() : null;
}

export function normalizeShippoShipmentRates(rates: ShippoRate[]): NormalizedShippoRate[] {
  return rates.flatMap((rate) => {
    const objectId = typeof rate.object_id === "string" ? rate.object_id.trim() : "";
    const amount = safeProviderShippingCents(rate.amount);
    const currency = normalizeShippoRateCurrency(rate.currency);
    if (!objectId || amount === null || !currency) return [];

    return [{
      objectId,
      provider: rate.provider,
      servicelevel_name: rate.servicelevel?.name ?? null,
      amount,
      currency,
      est_days: Number.isFinite(rate.est_days) ? rate.est_days ?? null : null,
    }];
  });
}

// Minimal generic wrapper (some routes import this)
export async function shippoRequest<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  if (!SHIPPO_API_KEY) throw new Error("Missing SHIPPO_API_KEY");
  const headers: Record<string, string> = {
    Authorization: `ShippoToken ${SHIPPO_API_KEY}`,
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  const res = await fetchWithTimeout(`${SHIPPO_BASE}${path}`, { ...init, headers }, 15_000);
  if (!res.ok) {
    const text = await readResponseTextWithTimeout(res);
    throw new Error(shippoProviderErrorMessage("Shippo request failed", res.status, res.statusText, text));
  }
  return (await res.json()) as T;
}

// Your existing multi-piece rating helper (kept as-is)
export async function shippoRatesMultiPiece(opts: {
  from: Address;
  to: Address;
  parcels: Parcel[];
}) {
  const { from, to, parcels } = opts;

  const shipment = {
    address_from: {
      name: from.name,
      street1: from.street1,
      street2: from.street2,
      city: from.city,
      state: from.state,
      zip: from.zip,
      country: from.country,
    },
    address_to: {
      name: to.name,
      street1: to.street1,
      street2: to.street2,
      city: to.city,
      state: to.state,
      zip: to.zip,
      country: to.country,
    },
    parcels: parcels.map((p) => ({
      weight: String(p.weight.value),
      mass_unit: "g",
      ...(p.length && { length: p.length }),
      ...(p.width && { width: p.width }),
      ...(p.height && { height: p.height }),
      distance_unit: "cm",
    })),
  };

  const res = await fetchWithTimeout(`${SHIPPO_BASE}/shipments/`, {
    method: "POST",
    headers: {
      Authorization: `ShippoToken ${SHIPPO_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...shipment, async: false }),
  }, 20_000);

  if (!res.ok) {
    const t = await readResponseTextWithTimeout(res);
    throw new Error(shippoProviderErrorMessage("Shippo create shipment failed", res.status, res.statusText, t));
  }

  const shipmentObj = await res.json();
  const rates = normalizeShippoShipmentRates(((shipmentObj as { rates?: ShippoRate[] }).rates || []));

  return { shipmentId: shipmentObj.object_id, rates };
}
