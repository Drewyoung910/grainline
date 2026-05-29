import { normalizeUsState } from "@/lib/usStates";

export type AddressAutocompleteResult = {
  label: string;
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  lat: number | null;
  lng: number | null;
};

export type NominatimPlace = {
  display_name?: string;
  lat?: string;
  lon?: string;
  address?: {
    house_number?: string;
    road?: string;
    pedestrian?: string;
    footway?: string;
    cycleway?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    suburb?: string;
    neighbourhood?: string;
    city_district?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country_code?: string;
  };
};

export function normalizeAddressAutocompleteQuery(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
}

function firstNonEmpty(...values: Array<string | null | undefined>) {
  return values.find((value) => value?.trim())?.trim() ?? "";
}

export function formatAddressLabel({
  line1,
  city,
  state,
  postalCode,
  fallback,
}: {
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  fallback?: string;
}) {
  const locality = [city, [state, postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const label = [line1, locality].filter(Boolean).join(", ");
  const cleanFallback = fallback
    ?.split(",")
    .map((part) => part.trim())
    .filter((part) => part && !/\bcounty\b/i.test(part))
    .join(", ");
  return label || cleanFallback || "";
}

export function placeToAddress(place: NominatimPlace): AddressAutocompleteResult {
  const address = place.address ?? {};
  const street = address.road ?? address.pedestrian ?? address.footway ?? address.cycleway ?? "";
  const line1 = [address.house_number, street].filter(Boolean).join(" ").trim();
  const city = firstNonEmpty(address.city, address.town, address.village, address.municipality);
  const lat = Number.parseFloat(place.lat ?? "");
  const lng = Number.parseFloat(place.lon ?? "");
  const state = normalizeUsState(address.state);
  const postalCode = address.postcode ?? "";

  return {
    label: formatAddressLabel({ line1, city, state, postalCode, fallback: place.display_name }),
    line1,
    city,
    state,
    postalCode,
    country: (address.country_code ?? "US").toUpperCase(),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
}
