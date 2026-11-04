import {
  type DbUserContextTransactionClient,
  withDbUserContext,
} from "@/lib/dbUserContext";
import { isTextWithinCodePointRange } from "@/lib/textLength";

export type SellerTransactionState = Readonly<{
  id: string;
  userId: string;
  displayName: string;
  chargesEnabled: boolean;
  stripeAccountSupported: boolean;
  ownerAccountActive: boolean;
  vacationMode: boolean;
  acceptingNewOrders: boolean;
  freeShippingOverCents: number | null;
  shippingFlatRateCents: number | null;
  allowLocalPickup: boolean;
  offersGiftWrapping: boolean;
  giftWrappingPriceCents: number | null;
}>;

type ListingActorTransactionSourceRow = {
  id: unknown;
  sellerId: unknown;
  title: unknown;
  description: unknown;
  priceCents: unknown;
  priceVersion: unknown;
  currency: unknown;
  status: unknown;
  listingType: unknown;
  processingTimeMinDays: unknown;
  processingTimeMaxDays: unknown;
  shipsWithinDays: unknown;
  category: unknown;
  tags: unknown;
  stockQuantity: unknown;
  packagedWeightGrams: unknown;
  packagedLengthCm: unknown;
  packagedWidthCm: unknown;
  packagedHeightCm: unknown;
  isPrivate: unknown;
  reservedForUserId: unknown;
  photos: unknown;
  variantGroups: unknown;
  sellerUserId: unknown;
  sellerDisplayName: unknown;
  sellerChargesEnabled: unknown;
  sellerStripeAccountSupported: unknown;
  sellerOwnerAccountActive: unknown;
  sellerVacationMode: unknown;
  sellerAcceptingNewOrders: unknown;
  sellerFreeShippingOverCents: unknown;
  sellerShippingFlatRateCents: unknown;
  sellerAllowLocalPickup: unknown;
  sellerOffersGiftWrapping: unknown;
  sellerGiftWrappingPriceCents: unknown;
};

type ListingActorCartTransactionSourceRow = ListingActorTransactionSourceRow & {
  cartItemId: unknown;
};

type ListingTransactionPhoto = Readonly<{ url: string }>;
type ListingTransactionVariantOption = Readonly<{
  id: string;
  label: string;
  priceAdjustCents: number;
  inStock: boolean;
}>;
type ListingTransactionVariantGroup = Readonly<{
  id: string;
  name: string;
  options: ReadonlyArray<ListingTransactionVariantOption>;
}>;

const sellerTransactionContextOptions = {
  isolationLevel: "RepeatableRead" as const,
};

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/u.test(value);
}
function validNullableCents(value: unknown): value is number | null {
  return value === null || (Number.isInteger(value) && Number(value) >= 0);
}
function validSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}
function validNullableNonnegativeNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}
function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const LISTING_TRANSACTION_STATUSES = new Set([
  "DRAFT",
  "ACTIVE",
  "SOLD",
  "SOLD_OUT",
  "HIDDEN",
  "PENDING_REVIEW",
  "REJECTED",
]);
const LISTING_TRANSACTION_TYPES = new Set(["IN_STOCK", "MADE_TO_ORDER"]);

function parseListingTransactionPhotos(value: unknown): ReadonlyArray<ListingTransactionPhoto> | null {
  if (!Array.isArray(value) || value.length > 10) return null;
  const photos: ListingTransactionPhoto[] = [];
  for (const candidate of value) {
    const photo = recordValue(candidate);
    if (!photo || !isTextWithinCodePointRange(photo.url, 1, 2048)) return null;
    photos.push(Object.freeze({ url: photo.url }));
  }
  return Object.freeze(photos);
}

function parseListingTransactionVariantGroups(
  value: unknown,
): ReadonlyArray<ListingTransactionVariantGroup> | null {
  if (!Array.isArray(value) || value.length > 3) return null;
  const groupIds = new Set<string>();
  const optionIds = new Set<string>();
  const groups: ListingTransactionVariantGroup[] = [];
  for (const candidate of value) {
    const group = recordValue(candidate);
    if (
      !group
      || !validId(group.id)
      || groupIds.has(group.id)
      || !isTextWithinCodePointRange(group.name, 1, 100)
      || !Array.isArray(group.options)
      || group.options.length > 10
    ) return null;
    groupIds.add(group.id);
    const options: ListingTransactionVariantOption[] = [];
    for (const optionCandidate of group.options) {
      const option = recordValue(optionCandidate);
      if (
        !option
        || !validId(option.id)
        || optionIds.has(option.id)
        || !isTextWithinCodePointRange(option.label, 1, 100)
        || !validSafeInteger(option.priceAdjustCents)
        || option.priceAdjustCents < -10_000_000
        || option.priceAdjustCents > 10_000_000
        || typeof option.inStock !== "boolean"
      ) return null;
      optionIds.add(option.id);
      options.push(Object.freeze({
        id: option.id,
        label: option.label,
        priceAdjustCents: option.priceAdjustCents,
        inStock: option.inStock,
      }));
    }
    groups.push(Object.freeze({
      id: group.id,
      name: group.name,
      options: Object.freeze(options),
    }));
  }
  return Object.freeze(groups);
}

function validSellerTransactionState(row: unknown): row is SellerTransactionState {
  const candidate = recordValue(row);
  return Boolean(
    candidate
    && validId(candidate.id)
    && validId(candidate.userId)
    && isTextWithinCodePointRange(candidate.displayName, 1, 100)
    && typeof candidate.chargesEnabled === "boolean"
    && typeof candidate.stripeAccountSupported === "boolean"
    && typeof candidate.ownerAccountActive === "boolean"
    && typeof candidate.vacationMode === "boolean"
    && typeof candidate.acceptingNewOrders === "boolean"
    && validNullableCents(candidate.freeShippingOverCents)
    && validNullableCents(candidate.shippingFlatRateCents)
    && typeof candidate.allowLocalPickup === "boolean"
    && typeof candidate.offersGiftWrapping === "boolean"
    && validNullableCents(candidate.giftWrappingPriceCents)
  );
}

function parseListingActorTransactionSourceRow(row: ListingActorTransactionSourceRow) {
  const photos = parseListingTransactionPhotos(row.photos);
  const variantGroups = parseListingTransactionVariantGroups(row.variantGroups);
  const sellerCandidate = {
    id: row.sellerId,
    userId: row.sellerUserId,
    displayName: row.sellerDisplayName,
    chargesEnabled: row.sellerChargesEnabled,
    stripeAccountSupported: row.sellerStripeAccountSupported,
    ownerAccountActive: row.sellerOwnerAccountActive,
    vacationMode: row.sellerVacationMode,
    acceptingNewOrders: row.sellerAcceptingNewOrders,
    freeShippingOverCents: row.sellerFreeShippingOverCents,
    shippingFlatRateCents: row.sellerShippingFlatRateCents,
    allowLocalPickup: row.sellerAllowLocalPickup,
    offersGiftWrapping: row.sellerOffersGiftWrapping,
    giftWrappingPriceCents: row.sellerGiftWrappingPriceCents,
  };
  if (
    !validId(row.id)
    || !validId(row.sellerId)
    || !isTextWithinCodePointRange(row.title, 1, 150)
    || !isTextWithinCodePointRange(row.description, 0, 5_000)
    || !validSafeInteger(row.priceCents)
    || row.priceCents < 1
    || !validSafeInteger(row.priceVersion)
    || row.priceVersion < 1
    || !isTextWithinCodePointRange(row.currency, 3, 3)
    || typeof row.status !== "string"
    || !LISTING_TRANSACTION_STATUSES.has(row.status)
    || typeof row.listingType !== "string"
    || !LISTING_TRANSACTION_TYPES.has(row.listingType)
    || !(row.processingTimeMinDays === null || (
      validSafeInteger(row.processingTimeMinDays) && row.processingTimeMinDays >= 1
    ))
    || !(row.processingTimeMaxDays === null || (
      validSafeInteger(row.processingTimeMaxDays) && row.processingTimeMaxDays >= 1
    ))
    || !(row.shipsWithinDays === null || (
      validSafeInteger(row.shipsWithinDays) && row.shipsWithinDays >= 1
    ))
    || !(row.category === null || isTextWithinCodePointRange(row.category, 1, 50))
    || !Array.isArray(row.tags)
    || row.tags.length > 50
    || row.tags.some((tag) => !isTextWithinCodePointRange(tag, 1, 100))
    || !(row.stockQuantity === null || (validSafeInteger(row.stockQuantity) && row.stockQuantity >= 0))
    || !(row.packagedWeightGrams === null || (
      validSafeInteger(row.packagedWeightGrams) && row.packagedWeightGrams >= 0
    ))
    || !validNullableNonnegativeNumber(row.packagedLengthCm)
    || !validNullableNonnegativeNumber(row.packagedWidthCm)
    || !validNullableNonnegativeNumber(row.packagedHeightCm)
    || typeof row.isPrivate !== "boolean"
    || !(row.reservedForUserId === null || validId(row.reservedForUserId))
    || photos === null
    || variantGroups === null
    || !validSellerTransactionState(sellerCandidate)
    || sellerCandidate.id !== row.sellerId
  ) {
    throw new TypeError("Listing actor transaction authority returned an invalid result");
  }
  return Object.freeze({
    id: row.id,
    sellerId: row.sellerId,
    title: row.title,
    description: row.description,
    priceCents: row.priceCents,
    priceVersion: row.priceVersion,
    currency: row.currency,
    status: row.status,
    listingType: row.listingType,
    processingTimeMinDays: row.processingTimeMinDays,
    processingTimeMaxDays: row.processingTimeMaxDays,
    shipsWithinDays: row.shipsWithinDays,
    category: row.category,
    tags: Object.freeze([...row.tags]),
    stockQuantity: row.stockQuantity,
    packagedWeightGrams: row.packagedWeightGrams,
    packagedLengthCm: row.packagedLengthCm,
    packagedWidthCm: row.packagedWidthCm,
    packagedHeightCm: row.packagedHeightCm,
    isPrivate: row.isPrivate,
    reservedForUserId: row.reservedForUserId,
    photos,
    variantGroups,
    seller: Object.freeze(sellerCandidate),
  });
}

async function readListingActorTransactionSource(
  client: Pick<DbUserContextTransactionClient, "$queryRaw">,
  listingId: string,
) {
  if (!validId(listingId)) {
    throw new RangeError("Listing actor transaction-source input is invalid");
  }
  const rows = await client.$queryRaw<ListingActorTransactionSourceRow[]>`
    SELECT *
      FROM public.grainline_listing_actor_transaction_source(${listingId}::text)
  `;
  if (rows.length === 0) return null;
  if (rows.length !== 1) {
    throw new TypeError("Listing actor transaction authority returned multiple rows");
  }
  return parseListingActorTransactionSourceRow(rows[0]);
}

export async function readListingActorCartTransactionSources(
  client: Pick<DbUserContextTransactionClient, "$queryRaw">,
  cartId: string,
) {
  if (!validId(cartId)) {
    throw new RangeError("Listing actor cart transaction-source input is invalid");
  }
  const rows = await client.$queryRaw<ListingActorCartTransactionSourceRow[]>`
    SELECT *
      FROM public.grainline_listing_actor_cart_transaction_sources(${cartId}::text)
  `;
  if (rows.length > 50) {
    throw new TypeError("Listing actor cart transaction authority exceeded the cart limit");
  }
  const cartItemIds = new Set<string>();
  return Object.freeze(rows.map((row) => {
    if (!validId(row.cartItemId) || cartItemIds.has(row.cartItemId)) {
      throw new TypeError("Listing actor cart transaction authority returned an invalid item");
    }
    cartItemIds.add(row.cartItemId);
    return Object.freeze({
      cartItemId: row.cartItemId,
      listing: parseListingActorTransactionSourceRow(row),
    });
  }));
}

export async function readSellerActorListingTransactionState(
  client: Pick<DbUserContextTransactionClient, "$queryRaw">,
  listingId: string,
) {
  if (!validId(listingId)) {
    throw new RangeError("Seller listing transaction-state input is invalid");
  }
  const rows = await client.$queryRaw<SellerTransactionState[]>`
    SELECT *
      FROM public.grainline_seller_actor_listing_transaction_state(
        ${listingId}::text
      )
  `;
  const row = rows[0];
  if (rows.length > 1 || (row && !validSellerTransactionState(row))) {
    throw new TypeError("Seller listing transaction authority returned an invalid result");
  }
  return row ?? null;
}

export async function readSellerActorCartTransactionStates(
  client: Pick<DbUserContextTransactionClient, "$queryRaw">,
  cartId: string,
) {
  if (!validId(cartId)) {
    throw new RangeError("Seller cart transaction-state input is invalid");
  }
  const rows = await client.$queryRaw<SellerTransactionState[]>`
    SELECT *
      FROM public.grainline_seller_actor_cart_transaction_states(
        ${cartId}::text
      )
  `;
  if (
    rows.length > 50
    || rows.some((row) => !validSellerTransactionState(row))
    || new Set(rows.map((row) => row.id)).size !== rows.length
  ) {
    throw new TypeError("Seller cart transaction authority returned an invalid result");
  }
  return rows;
}

export function sellerListingTransactionSource(actorUserId: string, listingId: string) {
  return withDbUserContext(
    actorUserId,
    (client) => readListingActorTransactionSource(client, listingId),
    sellerTransactionContextOptions,
  );
}

export function sellerSingleCheckoutSource(actorUserId: string, listingId: string) {
  return withDbUserContext(
    actorUserId,
    (client) => readListingActorTransactionSource(client, listingId),
    sellerTransactionContextOptions,
  );
}

export function sellerSingleCheckoutResumeSource(actorUserId: string, listingId: string) {
  return withDbUserContext(
    actorUserId,
    (client) => readListingActorTransactionSource(client, listingId),
    sellerTransactionContextOptions,
  );
}

export function withSellerActorCartTransaction<T>(
  actorUserId: string,
  operation: (
    client: DbUserContextTransactionClient,
    sellerStates: (cartId: string) => Promise<SellerTransactionState[]>,
  ) => Promise<T>,
) {
  return withDbUserContext(
    actorUserId,
    (client) => operation(
      client,
      (cartId) => readSellerActorCartTransactionStates(client, cartId),
    ),
    sellerTransactionContextOptions,
  );
}

export function attachCartSellerStates<
  T extends { listing: { sellerId: string } },
>(items: T[], states: SellerTransactionState[]) {
  const bySellerId = new Map(states.map((state) => [state.id, state]));
  return items.map((item) => {
    const seller = bySellerId.get(item.listing.sellerId);
    if (!seller) {
      throw new Error("Seller cart transaction authority omitted a cart seller");
    }
    return {
      ...item,
      listing: { ...item.listing, seller },
    };
  });
}
