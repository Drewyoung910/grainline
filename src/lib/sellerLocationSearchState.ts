import type { NominatimPlace } from "./addressAutocompleteState.ts";
import { normalizeUsState } from "./usStates.ts";

export type SellerLocationSearchResult = {
  label: string;
  city: string;
  state: string;
  postalCode: string;
  lat: number;
  lng: number;
};

const US_POSTAL_CODE = /^\d{5}(?:-\d{4})?$/u;
const CITY_AND_STATE = /^([\p{L}][\p{L} .'-]{1,79}),\s*([\p{L} .'-]{2,30})$/u;

/**
 * Public Nominatim may receive only a broad US locality or postal code.
 * Street numbers, free-form places and precise coordinates are deliberately
 * outside this contract.
 */
export function normalizeSellerLocationSearchQuery(value: string | null | undefined) {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (US_POSTAL_CODE.test(normalized)) return normalized;
  if (/\d/u.test(normalized)) return null;

  const match = CITY_AND_STATE.exec(normalized);
  if (!match) return null;
  const city = match[1].trim();
  const state = normalizeUsState(match[2]);
  if (!state || /\b(?:county|parish)\b/iu.test(city)) return null;
  return `${city}, ${state}`;
}

export function sellerLocationPlaceToResult(
  place: NominatimPlace,
): SellerLocationSearchResult | null {
  const address = place.address ?? {};
  if (
    address.house_number
    || address.road
    || address.pedestrian
    || address.footway
    || address.cycleway
  ) {
    return null;
  }

  const city = (
    address.city
    ?? address.town
    ?? address.village
    ?? address.municipality
    ?? ""
  ).trim();
  const state = normalizeUsState(address.state);
  const postalCode = (address.postcode ?? "").trim();
  const lat = Number(place.lat);
  const lng = Number(place.lon);
  if (
    !city
    || !state
    || /\b(?:county|parish)\b/iu.test(city)
    || !Number.isFinite(lat)
    || !Number.isFinite(lng)
    || Math.abs(lat) > 90
    || Math.abs(lng) > 180
  ) {
    return null;
  }

  return {
    label: `${city}, ${state}${postalCode ? ` ${postalCode}` : ""}`,
    city,
    state,
    postalCode,
    lat,
    lng,
  };
}
