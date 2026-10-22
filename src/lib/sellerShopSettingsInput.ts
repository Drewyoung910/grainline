import { SELLER_EXACT_MAP_CONSENT_VERSION } from "./sellerExactMapConsent.ts";

export const MAX_SELLER_LOCATION_RADIUS_METERS = 8_047;

export type SellerLocationPoint = Readonly<{
  lat: number;
  lng: number;
}>;

type SellerLocationInput = {
  lat: unknown;
  lng: unknown;
  radiusMeters: unknown;
  publicMapOptIn: boolean;
  publicMapExactConsent: boolean;
  publicMapExactConsentVersion: unknown;
  publicMapExactConsentLat: unknown;
  publicMapExactConsentLng: unknown;
};

type SellerLocationValue = {
  lat: number | null;
  lng: number | null;
  radiusMeters: number | null;
  publicMapOptIn: boolean;
  publicMapExactConsent: boolean;
  publicMapExactConsentVersion: number | null;
  publicMapExactConsentLat: number | null;
  publicMapExactConsentLng: number | null;
};

type InputResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

type OptionalNumber =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "value"; value: number };

const LOCATION_INPUT_ERROR =
  "Enter a valid pickup location, with latitude from -90 to 90, longitude from -180 to 180, and a radius from 0 to 5 miles.";

function optionalStrictNumber(value: unknown): OptionalNumber {
  if (value === null || value === undefined) return { kind: "empty" };
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? { kind: "value", value }
      : { kind: "invalid" };
  }
  if (typeof value !== "string") return { kind: "invalid" };
  const raw = value.trim();
  if (raw === "") return { kind: "empty" };
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(raw)) {
    return { kind: "invalid" };
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed)
    ? { kind: "value", value: parsed }
    : { kind: "invalid" };
}

export function sellerLocationPoint(
  lat: unknown,
  lng: unknown,
): SellerLocationPoint | null {
  return typeof lat === "number"
    && Number.isFinite(lat)
    && lat >= -90
    && lat <= 90
    && typeof lng === "number"
    && Number.isFinite(lng)
    && lng >= -180
    && lng <= 180
    ? { lat, lng }
    : null;
}

export function parseSellerLocationInput(
  input: SellerLocationInput,
): InputResult<SellerLocationValue> {
  const parsedLat = optionalStrictNumber(input.lat);
  const parsedLng = optionalStrictNumber(input.lng);
  const parsedRadius = optionalStrictNumber(input.radiusMeters);
  const parsedConsentVersion = optionalStrictNumber(input.publicMapExactConsentVersion);
  const parsedConsentLat = optionalStrictNumber(input.publicMapExactConsentLat);
  const parsedConsentLng = optionalStrictNumber(input.publicMapExactConsentLng);

  if ([
    parsedLat,
    parsedLng,
    parsedRadius,
    parsedConsentVersion,
    parsedConsentLat,
    parsedConsentLng,
  ].some((entry) => entry.kind === "invalid")) {
    return { ok: false, error: LOCATION_INPUT_ERROR };
  }

  const lat = parsedLat.kind === "value" ? parsedLat.value : null;
  const lng = parsedLng.kind === "value" ? parsedLng.value : null;
  let radiusMeters = parsedRadius.kind === "value" ? parsedRadius.value : null;
  const point = sellerLocationPoint(lat, lng);

  if ((lat === null) !== (lng === null)
    || (lat !== null && point === null)
    || (!point && radiusMeters !== null)
    || (radiusMeters !== null
      && (!Number.isSafeInteger(radiusMeters)
        || radiusMeters < 0
        || radiusMeters > MAX_SELLER_LOCATION_RADIUS_METERS))) {
    return { ok: false, error: LOCATION_INPUT_ERROR };
  }

  if (input.publicMapOptIn) {
    if (!point) {
      return { ok: false, error: "To appear on the public map, set a pin location." };
    }
    radiusMeters = 0;
  }

  const exactVersion = parsedConsentVersion.kind === "value"
    ? parsedConsentVersion.value
    : null;
  const exactLat = parsedConsentLat.kind === "value" ? parsedConsentLat.value : null;
  const exactLng = parsedConsentLng.kind === "value" ? parsedConsentLng.value : null;

  if (!input.publicMapExactConsent) {
    if (exactVersion !== null || exactLat !== null || exactLng !== null) {
      return {
        ok: false,
        error: "Your map settings changed. Reload the page and review them again.",
      };
    }
    return {
      ok: true,
      value: {
        lat: point?.lat ?? null,
        lng: point?.lng ?? null,
        radiusMeters,
        publicMapOptIn: input.publicMapOptIn,
        publicMapExactConsent: false,
        publicMapExactConsentVersion: null,
        publicMapExactConsentLat: null,
        publicMapExactConsentLng: null,
      },
    };
  }

  if (!input.publicMapOptIn) {
    return {
      ok: false,
      error: "Turn on public map visibility before publishing your exact pin.",
    };
  }
  if (!point
    || exactVersion !== SELLER_EXACT_MAP_CONSENT_VERSION
    || exactLat !== point.lat
    || exactLng !== point.lng) {
    return {
      ok: false,
      error: "Your pickup pin changed. Review the exact-location consent and check it again.",
    };
  }

  return {
    ok: true,
    value: {
      lat: point.lat,
      lng: point.lng,
      radiusMeters,
      publicMapOptIn: true,
      publicMapExactConsent: true,
      publicMapExactConsentVersion: SELLER_EXACT_MAP_CONSENT_VERSION,
      publicMapExactConsentLat: point.lat,
      publicMapExactConsentLng: point.lng,
    },
  };
}

export function validateSellerShippingInput(
  countryInput: unknown,
  carrierInputs: unknown[],
): InputResult<{ shipFromCountry: string; preferredCarriers: string[] }> {
  if (countryInput !== null
    && countryInput !== undefined
    && typeof countryInput !== "string") {
    return { ok: false, error: "Enter a two-letter ship-from country code, for example US." };
  }
  const rawCountry = typeof countryInput === "string" ? countryInput.trim() : "";
  const shipFromCountry = (rawCountry || "US").toUpperCase();
  if (!/^[A-Z]{2}$/u.test(shipFromCountry)) {
    return { ok: false, error: "Enter a two-letter ship-from country code, for example US." };
  }
  if (!carrierInputs.every((carrier) => typeof carrier === "string")) {
    return { ok: false, error: "The preferred carrier selection is invalid." };
  }
  const preferredCarriers = (carrierInputs as string[])
    .map((carrier) => carrier.trim())
    .filter(Boolean);
  if (preferredCarriers.length > 16
    || preferredCarriers.some((carrier) => carrier.length > 32)) {
    return { ok: false, error: "The preferred carrier selection is invalid." };
  }
  return { ok: true, value: { shipFromCountry, preferredCarriers } };
}

export function sellerShopSettingsDatabaseErrorMessage(
  sqlState: string | null,
): string | null {
  if (sqlState === "22023" || sqlState === "23514") {
    return "Some shop settings were invalid. Review the fields and try again.";
  }
  if (sqlState === "42501") {
    return "Your shop settings could not be updated. Refresh the page and try again.";
  }
  if (sqlState === "40001") {
    return "Your shop settings changed while they were being saved. Refresh the page and try again.";
  }
  return null;
}
