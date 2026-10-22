export const SELLER_EXACT_MAP_CONSENT_VERSION = 1;

export const SELLER_EXACT_MAP_CONSENT_TEXT =
  "By saving with this checked, you consent to showing the precise pin on public maps, shop and listing pages, and structured search data. Anyone can view it. Use a workshop or business address rather than your home address. Uncheck it to return to an approximate pin.";

export const SELLER_EXACT_MAP_CONSENT_TEXT_SHA256 =
  "9e47412158887b4020ced7ef658007518abeaff99642635c1e9d47a1f9bbab8c";

export type ExactMapConsentBinding = Readonly<{
  version: number;
  lat: number;
  lng: number;
}>;

export function exactMapConsentBinding(
  enabled: boolean,
  lat: number,
  lng: number,
): ExactMapConsentBinding | null {
  if (!enabled || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    version: SELLER_EXACT_MAP_CONSENT_VERSION,
    lat,
    lng,
  };
}

export function exactMapConsentBindingMatches(
  binding: ExactMapConsentBinding | null,
  lat: number,
  lng: number,
) {
  return binding !== null && binding.lat === lat && binding.lng === lng;
}
