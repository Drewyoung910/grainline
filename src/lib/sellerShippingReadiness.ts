export const SELLER_SHIPPING_SETUP_REQUIRED_MESSAGE =
  "This maker's shipping setup is incomplete. They need to update Shop Settings before this order can ship.";

export const OWNER_SHIPPING_SETUP_REQUIRED_MESSAGE =
  "Set up a flat shipping rate, local pickup, or a complete ship-from address and package measurements in Shop Settings before publishing.";

type SellerShippingReadinessState = Readonly<{
  shippingFlatRateCents: number | null;
  allowLocalPickup: boolean;
  shipFromLine1: string | null;
  shipFromCity: string | null;
  shipFromState: string | null;
  shipFromPostal: string | null;
  shipFromCountry: string | null;
  defaultPkgWeightGrams: number | null;
  defaultPkgLengthCm: number | null;
  defaultPkgWidthCm: number | null;
  defaultPkgHeightCm: number | null;
}>;

type ListingPackageState = Readonly<{
  packagedWeightGrams: number | null;
  packagedLengthCm: number | null;
  packagedWidthCm: number | null;
  packagedHeightCm: number | null;
}>;

export type SellerListingShippingReadiness = Readonly<{
  ready: boolean;
  hasFlatRate: boolean;
  allowsLocalPickup: boolean;
  hasCompleteShipFrom: boolean;
  hasCompletePackage: boolean;
}>;

function hasText(value: string | null) {
  return typeof value === "string" && value.trim().length > 0;
}

function positiveFinite(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function evaluateSellerListingShippingReadiness(
  seller: SellerShippingReadinessState,
  listing: ListingPackageState | null,
): SellerListingShippingReadiness {
  const hasFlatRate = Number.isSafeInteger(seller.shippingFlatRateCents)
    && (seller.shippingFlatRateCents ?? -1) >= 0;
  const allowsLocalPickup = seller.allowLocalPickup === true;
  const hasCompleteShipFrom = hasText(seller.shipFromLine1)
    && hasText(seller.shipFromCity)
    && hasText(seller.shipFromState)
    && hasText(seller.shipFromPostal)
    && hasText(seller.shipFromCountry);
  const hasCompletePackage = positiveFinite(
    listing?.packagedWeightGrams ?? seller.defaultPkgWeightGrams,
  ) && positiveFinite(
    listing?.packagedLengthCm ?? seller.defaultPkgLengthCm,
  ) && positiveFinite(
    listing?.packagedWidthCm ?? seller.defaultPkgWidthCm,
  ) && positiveFinite(
    listing?.packagedHeightCm ?? seller.defaultPkgHeightCm,
  );

  return Object.freeze({
    ready: hasFlatRate
      || allowsLocalPickup
      || (hasCompleteShipFrom && hasCompletePackage),
    hasFlatRate,
    allowsLocalPickup,
    hasCompleteShipFrom,
    hasCompletePackage,
  });
}
