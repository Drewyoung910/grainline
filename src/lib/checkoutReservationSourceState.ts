import {
  resolveListingVariantSelection,
  validateVariantUnitPriceCents,
} from "./listingVariants.ts";
import { DEFAULT_CURRENCY } from "./money.ts";

type CheckoutSourceSeller = Readonly<{
  id: string;
  userId: string;
  displayName: string | null;
  stripeAccountId: string | null;
  stripeAccountVersion: string | null;
  chargesEnabled: boolean;
  vacationMode: boolean;
  acceptingNewOrders: boolean;
  allowLocalPickup: boolean;
  offersGiftWrapping: boolean;
  giftWrappingPriceCents: number | null;
  defaultPkgWeightGrams: number | null;
  defaultPkgLengthCm: number | null;
  defaultPkgWidthCm: number | null;
  defaultPkgHeightCm: number | null;
  user: Readonly<{ banned: boolean; deletedAt: Date | null }>;
}>;

type CheckoutSourceListing = Readonly<{
  id: string;
  sellerId: string;
  title: string;
  description: string;
  priceCents: number;
  priceVersion: number;
  currency: string | null;
  status: string;
  listingType: string;
  processingTimeMinDays: number | null;
  processingTimeMaxDays: number | null;
  shipsWithinDays: number | null;
  category: string | null;
  tags: readonly string[];
  isPrivate: boolean;
  reservedForUserId: string | null;
  packagedWeightGrams: number | null;
  packagedLengthCm: number | null;
  packagedWidthCm: number | null;
  packagedHeightCm: number | null;
  photos: ReadonlyArray<Readonly<{ url: string }>>;
  seller: CheckoutSourceSeller;
  variantGroups: ReadonlyArray<Readonly<{
    id: string;
    name: string;
    options: ReadonlyArray<Readonly<{
      id: string;
      label: string;
      priceAdjustCents: number;
      inStock: boolean;
    }>>;
  }>>;
}>;

type CheckoutSourceCartItem = Readonly<{
  id: string;
  listingId: string;
  quantity: number;
  priceCents: number;
  priceVersion: number;
  selectedVariantOptionIds: readonly string[];
  listing: CheckoutSourceListing;
}>;

function isNullableFinite(value: number | null) {
  return value === null || Number.isFinite(value);
}

function sellerSource(seller: CheckoutSourceSeller) {
  if (
    !seller.id ||
    !seller.userId ||
    !seller.stripeAccountId ||
    !Number.isSafeInteger(seller.giftWrappingPriceCents ?? 0) ||
    !Number.isSafeInteger(seller.defaultPkgWeightGrams ?? 0) ||
    !isNullableFinite(seller.defaultPkgLengthCm) ||
    !isNullableFinite(seller.defaultPkgWidthCm) ||
    !isNullableFinite(seller.defaultPkgHeightCm) ||
    seller.user.banned ||
    seller.user.deletedAt !== null ||
    !seller.chargesEnabled ||
    seller.vacationMode ||
    !seller.acceptingNewOrders ||
    (seller.stripeAccountVersion !== null && seller.stripeAccountVersion !== "v2")
  ) {
    return null;
  }
  return {
    id: seller.id,
    userId: seller.userId,
    displayName: seller.displayName,
    stripeAccountId: seller.stripeAccountId,
    stripeAccountVersion: seller.stripeAccountVersion,
    chargesEnabled: seller.chargesEnabled,
    vacationMode: seller.vacationMode,
    acceptingNewOrders: seller.acceptingNewOrders,
    allowLocalPickup: seller.allowLocalPickup,
    offersGiftWrapping: seller.offersGiftWrapping,
    giftWrappingPriceCents: seller.giftWrappingPriceCents,
  };
}

function resolvedListingSource(
  listing: CheckoutSourceListing,
  quantity: number,
  selectedVariantOptionIds: readonly string[],
) {
  if (
    !listing.id ||
    !listing.sellerId ||
    !listing.title ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > 200 ||
    !Number.isSafeInteger(listing.priceCents) ||
    !Number.isSafeInteger(listing.priceVersion) ||
    !Number.isSafeInteger(listing.packagedWeightGrams ?? 0) ||
    !isNullableFinite(listing.packagedLengthCm) ||
    !isNullableFinite(listing.packagedWidthCm) ||
    !isNullableFinite(listing.packagedHeightCm)
  ) {
    return null;
  }
  const variantResolution = resolveListingVariantSelection(
    listing.variantGroups.map((group) => ({
      id: group.id,
      name: group.name,
      options: group.options.map((option) => ({ ...option })),
    })),
    [...selectedVariantOptionIds],
  );
  if (!variantResolution.ok) return null;

  const unitPriceCents = listing.priceCents + variantResolution.variantAdjustCents;
  if (validateVariantUnitPriceCents(unitPriceCents)) return null;

  return {
    listingId: listing.id,
    sellerId: listing.sellerId,
    title: listing.title,
    quantity,
    listingType: listing.listingType,
    currency: (listing.currency || DEFAULT_CURRENCY).toLowerCase(),
    listingPriceCents: listing.priceCents,
    priceVersion: listing.priceVersion,
    variantKey: variantResolution.variantKey,
    unitPriceCents,
    selectedVariants: variantResolution.selectedVariantsSnapshot,
    imageUrl: listing.photos[0]?.url ?? null,
    shippingWeightGrams: listing.packagedWeightGrams ?? listing.seller.defaultPkgWeightGrams ?? 0,
    shippingLengthCm: listing.packagedLengthCm ?? listing.seller.defaultPkgLengthCm ?? 0,
    shippingWidthCm: listing.packagedWidthCm ?? listing.seller.defaultPkgWidthCm ?? 0,
    shippingHeightCm: listing.packagedHeightCm ?? listing.seller.defaultPkgHeightCm ?? 0,
  };
}

function exactSignature(value: unknown) {
  return JSON.stringify(value);
}

function compareIdentifier(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalVariantSource(listing: CheckoutSourceListing) {
  return listing.variantGroups
    .map((group) => ({
      id: group.id,
      name: group.name,
      options: group.options
        .map((option) => ({
          id: option.id,
          label: option.label,
          priceAdjustCents: option.priceAdjustCents,
          inStock: option.inStock,
        }))
        .sort((left, right) => compareIdentifier(left.id, right.id)),
    }))
    .sort((left, right) => compareIdentifier(left.id, right.id));
}

function sellerSourceWitness(seller: CheckoutSourceSeller) {
  return {
    id: seller.id,
    userId: seller.userId,
    displayName: seller.displayName,
    stripeAccountId: seller.stripeAccountId,
    stripeAccountVersion: seller.stripeAccountVersion,
    chargesEnabled: seller.chargesEnabled,
    vacationMode: seller.vacationMode,
    acceptingNewOrders: seller.acceptingNewOrders,
    allowLocalPickup: seller.allowLocalPickup,
    offersGiftWrapping: seller.offersGiftWrapping,
    giftWrappingPriceCents: seller.giftWrappingPriceCents,
    defaultPkgWeightGrams: seller.defaultPkgWeightGrams,
    defaultPkgLengthCm: seller.defaultPkgLengthCm,
    defaultPkgWidthCm: seller.defaultPkgWidthCm,
    defaultPkgHeightCm: seller.defaultPkgHeightCm,
    userBanned: seller.user.banned,
    userDeleted: seller.user.deletedAt !== null,
  };
}

function listingSourceWitness(listing: CheckoutSourceListing) {
  return {
    id: listing.id,
    sellerId: listing.sellerId,
    title: listing.title,
    priceCents: listing.priceCents,
    priceVersion: listing.priceVersion,
    currency: listing.currency,
    status: listing.status,
    listingType: listing.listingType,
    isPrivate: listing.isPrivate,
    reservedForUserId: listing.reservedForUserId,
    packagedWeightGrams: listing.packagedWeightGrams,
    packagedLengthCm: listing.packagedLengthCm,
    packagedWidthCm: listing.packagedWidthCm,
    packagedHeightCm: listing.packagedHeightCm,
    imageUrl: listing.photos[0]?.url ?? null,
    variantGroups: canonicalVariantSource(listing),
  };
}

function listingSnapshotWitness(listing: CheckoutSourceListing) {
  return {
    ...listingSourceWitness(listing),
    description: listing.description,
    category: listing.category,
    tags: [...listing.tags],
    imageUrls: listing.photos.map((photo) => photo.url),
    processingTimeMinDays: listing.processingTimeMinDays,
    processingTimeMaxDays: listing.processingTimeMaxDays,
    shipsWithinDays: listing.shipsWithinDays,
  };
}

/**
 * Returns the raw database witness PostgreSQL independently rebuilds while all
 * checkout source rows are locked. The witness is rejection-only: the fixed
 * database function still derives every reservation and inventory target.
 */
export function cartCheckoutReservationSourceWitness(
  buyerId: string,
  sellerProfileId: string,
  items: readonly CheckoutSourceCartItem[],
): string | null {
  if (!cartCheckoutReservationSourceSignature(buyerId, sellerProfileId, items)) return null;
  return exactSignature({
    seller: sellerSourceWitness(items[0]!.listing.seller),
    items: items
      .map((item) => ({
        cartItemId: item.id,
        listingId: item.listingId,
        quantity: item.quantity,
        storedPriceCents: item.priceCents,
        storedPriceVersion: item.priceVersion,
        selectedVariantOptionIds: [...item.selectedVariantOptionIds],
        listing: listingSourceWitness(item.listing),
      }))
      .sort((left, right) => compareIdentifier(left.cartItemId, right.cartItemId)),
  });
}

/** Equivalent raw witness for Buy Now, including the caller's variant order. */
export function singleCheckoutReservationSourceWitness(
  buyerId: string,
  listing: CheckoutSourceListing,
  quantity: number,
  selectedVariantOptionIds: readonly string[],
): string | null {
  if (!singleCheckoutReservationSourceSignature(
    buyerId,
    listing,
    quantity,
    selectedVariantOptionIds,
  )) return null;
  return exactSignature({
    seller: sellerSourceWitness(listing.seller),
    item: {
      quantity,
      selectedVariantOptionIds: [...selectedVariantOptionIds],
      listing: listingSourceWitness(listing),
    },
  });
}

/**
 * Versioned Order-history source. It retains the predecessor pricing witness
 * and adds every mutable listing field copied into the eventual OrderItem.
 */
export function cartCheckoutReservationSnapshotWitness(
  buyerId: string,
  sellerProfileId: string,
  items: readonly CheckoutSourceCartItem[],
): string | null {
  const legacyWitness = cartCheckoutReservationSourceWitness(
    buyerId,
    sellerProfileId,
    items,
  );
  if (!legacyWitness) return null;
  const legacy = JSON.parse(legacyWitness) as {
    seller: ReturnType<typeof sellerSourceWitness>;
    items: Array<Record<string, unknown> & { cartItemId: string }>;
  };
  const itemById = new Map(items.map((item) => [item.id, item]));
  return exactSignature({
    seller: legacy.seller,
    items: legacy.items.map((item) => {
      const sourceItem = itemById.get(item.cartItemId);
      if (!sourceItem) throw new Error("Checkout snapshot witness lost a cart item");
      return { ...item, listing: listingSnapshotWitness(sourceItem.listing) };
    }),
  });
}

/** Equivalent full Order-history source for Buy Now. */
export function singleCheckoutReservationSnapshotWitness(
  buyerId: string,
  listing: CheckoutSourceListing,
  quantity: number,
  selectedVariantOptionIds: readonly string[],
): string | null {
  const legacyWitness = singleCheckoutReservationSourceWitness(
    buyerId,
    listing,
    quantity,
    selectedVariantOptionIds,
  );
  if (!legacyWitness) return null;
  const legacy = JSON.parse(legacyWitness) as {
    seller: ReturnType<typeof sellerSourceWitness>;
    item: Record<string, unknown>;
  };
  return exactSignature({
    seller: legacy.seller,
    item: { ...legacy.item, listing: listingSnapshotWitness(listing) },
  });
}

/**
 * Captures every mutable database value used to price, route, or describe a
 * seller-cart Stripe Checkout session. Call this once for the route snapshot
 * and once inside the transaction that creates the stock reservation.
 */
export function cartCheckoutReservationSourceSignature(
  buyerId: string,
  sellerProfileId: string,
  items: readonly CheckoutSourceCartItem[],
): string | null {
  if (!buyerId || !sellerProfileId || items.length === 0) return null;
  const firstSeller = sellerSource(items[0]!.listing.seller);
  if (!firstSeller || firstSeller.id !== sellerProfileId || firstSeller.userId === buyerId) return null;

  const sourceItems = [];
  for (const item of items) {
    const currentSeller = sellerSource(item.listing.seller);
    const resolved = resolvedListingSource(item.listing, item.quantity, item.selectedVariantOptionIds);
    if (
      !currentSeller ||
      exactSignature(currentSeller) !== exactSignature(firstSeller) ||
      item.listingId !== item.listing.id ||
      item.listing.sellerId !== sellerProfileId ||
      item.listing.status !== "ACTIVE" ||
      (item.listing.isPrivate && item.listing.reservedForUserId !== buyerId) ||
      (item.listing.listingType === "MADE_TO_ORDER" && item.quantity !== 1) ||
      !resolved ||
      item.priceCents !== resolved.unitPriceCents ||
      item.priceVersion !== resolved.priceVersion
    ) {
      return null;
    }
    sourceItems.push({
      cartItemId: item.id,
      storedPriceCents: item.priceCents,
      storedPriceVersion: item.priceVersion,
      ...resolved,
    });
  }

  return exactSignature({
    seller: firstSeller,
    items: sourceItems.sort((left, right) => compareIdentifier(left.cartItemId, right.cartItemId)),
  });
}

/** Captures the equivalent source for Buy Now, including the selected variant. */
export function singleCheckoutReservationSourceSignature(
  buyerId: string,
  listing: CheckoutSourceListing,
  quantity: number,
  selectedVariantOptionIds: readonly string[],
): string | null {
  const seller = sellerSource(listing.seller);
  const resolved = resolvedListingSource(listing, quantity, selectedVariantOptionIds);
  if (
    !buyerId ||
    !seller ||
    seller.id !== listing.sellerId ||
    seller.userId === buyerId ||
    listing.status !== "ACTIVE" ||
    (listing.isPrivate && listing.reservedForUserId !== buyerId) ||
    (listing.listingType === "MADE_TO_ORDER" && quantity !== 1) ||
    !resolved
  ) {
    return null;
  }
  return exactSignature({ seller, item: resolved });
}

export class CheckoutReservationSourceChangedError extends Error {
  constructor() {
    super("Checkout source changed while its stock reservation was being created");
    this.name = "CheckoutReservationSourceChangedError";
  }
}

type InventorySourceItem = Readonly<{
  listingId: string;
  sellerId: string;
  quantity: number;
}>;

function canonicalInventorySource(items: readonly InventorySourceItem[]) {
  const quantities = new Map<string, InventorySourceItem>();
  for (const item of items) {
    if (
      !item.listingId ||
      !item.sellerId ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1
    ) return null;
    const key = JSON.stringify([item.sellerId, item.listingId]);
    const quantity = (quantities.get(key)?.quantity ?? 0) + item.quantity;
    if (!Number.isSafeInteger(quantity)) return null;
    quantities.set(key, { ...item, quantity });
  }
  return JSON.stringify([...quantities.values()].sort((left, right) => (
    compareIdentifier(left.sellerId, right.sellerId) ||
    compareIdentifier(left.listingId, right.listingId)
  )));
}

/** Independently checks that the fixed function reserved the locked inventory set. */
export function checkoutReservationInventorySourceMatches(
  reservedItems: readonly InventorySourceItem[],
  pricedItems: readonly InventorySourceItem[],
) {
  const reserved = canonicalInventorySource(reservedItems);
  const priced = canonicalInventorySource(pricedItems);
  return reserved !== null && priced !== null && reserved === priced;
}
