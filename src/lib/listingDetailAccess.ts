import {
  Category,
  ListingStatus,
  ListingType,
  type Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  withDbUserContext,
  type DbUserContextTransactionClient,
} from "@/lib/dbUserContext";
import { isTextWithinCodePointRange } from "@/lib/textLength";

type ActorListingDetailClient = Pick<DbUserContextTransactionClient, "$queryRaw">;
type StaffListingDetailClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export type ListingDetailPhoto = Readonly<{
  id: string;
  url: string;
  altText: string | null;
}>;

export type ListingDetailVariantOption = Readonly<{
  id: string;
  label: string;
  priceAdjustCents: number;
  inStock: boolean;
}>;

export type ListingDetailVariantGroup = Readonly<{
  id: string;
  name: string;
  options: ReadonlyArray<ListingDetailVariantOption>;
}>;

export type ListingDetailMetro = Readonly<{
  slug: string;
  name: string;
  state: string;
}>;

export type ListingDetailSource = Readonly<{
  id: string;
  sellerId: string;
  title: string;
  description: string;
  metaDescription: string | null;
  priceCents: number;
  currency: string;
  status: ListingStatus;
  isPrivate: boolean;
  archivedAt: Date | null;
  reservedForUserId: string | null;
  listingType: ListingType;
  stockQuantity: number | null;
  shipsWithinDays: number | null;
  processingTimeMinDays: number | null;
  processingTimeMaxDays: number | null;
  category: Category | null;
  tags: ReadonlyArray<string>;
  materials: ReadonlyArray<string>;
  productLengthIn: number | null;
  productWidthIn: number | null;
  productHeightIn: number | null;
  metroId: string | null;
  cityMetroId: string | null;
  photos: ReadonlyArray<ListingDetailPhoto>;
  variantGroups: ReadonlyArray<ListingDetailVariantGroup>;
  metro: ListingDetailMetro | null;
  cityMetro: ListingDetailMetro | null;
}>;

type ListingDetailSourceRow = Readonly<{
  id: unknown;
  sellerId: unknown;
  title: unknown;
  description: unknown;
  metaDescription: unknown;
  priceCents: unknown;
  currency: unknown;
  status: unknown;
  isPrivate: unknown;
  archivedAt: unknown;
  reservedForUserId: unknown;
  listingType: unknown;
  stockQuantity: unknown;
  shipsWithinDays: unknown;
  processingTimeMinDays: unknown;
  processingTimeMaxDays: unknown;
  category: unknown;
  tags: unknown;
  materials: unknown;
  productLengthIn: unknown;
  productWidthIn: unknown;
  productHeightIn: unknown;
  metroId: unknown;
  cityMetroId: unknown;
  photos: unknown;
  variantGroups: unknown;
  metro: unknown;
  cityMetro: unknown;
}>;

const LISTING_STATUSES = new Set<string>(Object.values(ListingStatus));
const LISTING_TYPES = new Set<string>(Object.values(ListingType));
const CATEGORIES = new Set<string>(Object.values(Category));

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/u.test(value);
}

function validSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function validNullableNonnegativeInteger(value: unknown): value is number | null {
  return value === null || (validSafeInteger(value) && value >= 0);
}

function validNullablePositiveInteger(value: unknown): value is number | null {
  return value === null || (validSafeInteger(value) && value >= 1);
}

function validNullableNonnegativeNumber(value: unknown): value is number | null {
  return value === null
    || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parsePhotos(value: unknown): ReadonlyArray<ListingDetailPhoto> | null {
  if (!Array.isArray(value) || value.length > 10) return null;
  const ids = new Set<string>();
  const photos: ListingDetailPhoto[] = [];
  for (const candidate of value) {
    const photo = recordValue(candidate);
    if (
      !photo
      || !validId(photo.id)
      || ids.has(photo.id)
      || !isTextWithinCodePointRange(photo.url, 1, 2048)
      || !(
        photo.altText === null
        || isTextWithinCodePointRange(photo.altText, 0, 200)
      )
      || Object.hasOwn(photo, "originalUrl")
    ) return null;
    ids.add(photo.id);
    photos.push(Object.freeze({
      id: photo.id,
      url: photo.url,
      altText: photo.altText as string | null,
    }));
  }
  return Object.freeze(photos);
}

function parseVariantGroups(
  value: unknown,
): ReadonlyArray<ListingDetailVariantGroup> | null {
  if (!Array.isArray(value) || value.length > 3) return null;
  const groupIds = new Set<string>();
  const optionIds = new Set<string>();
  const groups: ListingDetailVariantGroup[] = [];
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
    const options: ListingDetailVariantOption[] = [];
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

function parseMetro(value: unknown): ListingDetailMetro | null | undefined {
  if (value === null) return null;
  const metro = recordValue(value);
  if (
    !metro
    || !isTextWithinCodePointRange(metro.slug, 1, 100)
    || !isTextWithinCodePointRange(metro.name, 1, 100)
    || !isTextWithinCodePointRange(metro.state, 1, 50)
  ) return undefined;
  return Object.freeze({
    slug: metro.slug,
    name: metro.name,
    state: metro.state,
  });
}

function parseListingDetailSource(
  rows: readonly ListingDetailSourceRow[],
  listingId: string,
): ListingDetailSource | null {
  if (rows.length === 0) return null;
  if (rows.length !== 1) {
    throw new TypeError("Listing detail authority returned multiple rows");
  }
  const row = rows[0];
  const photos = parsePhotos(row.photos);
  const variantGroups = parseVariantGroups(row.variantGroups);
  const metro = parseMetro(row.metro);
  const cityMetro = parseMetro(row.cityMetro);
  if (
    row.id !== listingId
    || !validId(row.id)
    || !validId(row.sellerId)
    || !isTextWithinCodePointRange(row.title, 1, 150)
    || !isTextWithinCodePointRange(row.description, 0, 5000)
    || !(
      row.metaDescription === null
      || isTextWithinCodePointRange(row.metaDescription, 0, 320)
    )
    || !validSafeInteger(row.priceCents)
    || row.priceCents < 1
    || !isTextWithinCodePointRange(row.currency, 3, 3)
    || typeof row.status !== "string"
    || !LISTING_STATUSES.has(row.status)
    || typeof row.isPrivate !== "boolean"
    || row.archivedAt !== null
    || !(row.reservedForUserId === null || validId(row.reservedForUserId))
    || typeof row.listingType !== "string"
    || !LISTING_TYPES.has(row.listingType)
    || !validNullableNonnegativeInteger(row.stockQuantity)
    || !validNullablePositiveInteger(row.shipsWithinDays)
    || !validNullablePositiveInteger(row.processingTimeMinDays)
    || !validNullablePositiveInteger(row.processingTimeMaxDays)
    || !(
      row.category === null
      || (typeof row.category === "string" && CATEGORIES.has(row.category))
    )
    || !Array.isArray(row.tags)
    || row.tags.length > 50
    || row.tags.some((tag) => !isTextWithinCodePointRange(tag, 0, 100))
    || !Array.isArray(row.materials)
    || row.materials.length > 20
    || row.materials.some(
      (material) => !isTextWithinCodePointRange(material, 1, 100),
    )
    || !validNullableNonnegativeNumber(row.productLengthIn)
    || !validNullableNonnegativeNumber(row.productWidthIn)
    || !validNullableNonnegativeNumber(row.productHeightIn)
    || !(row.metroId === null || validId(row.metroId))
    || !(row.cityMetroId === null || validId(row.cityMetroId))
    || photos === null
    || variantGroups === null
    || metro === undefined
    || cityMetro === undefined
    || (row.metroId === null) !== (metro === null)
    || (row.cityMetroId === null) !== (cityMetro === null)
  ) {
    throw new TypeError("Listing detail authority returned an invalid row");
  }
  return Object.freeze({
    id: row.id,
    sellerId: row.sellerId,
    title: row.title,
    description: row.description,
    metaDescription: row.metaDescription as string | null,
    priceCents: row.priceCents,
    currency: row.currency,
    status: row.status as ListingStatus,
    isPrivate: row.isPrivate,
    archivedAt: null,
    reservedForUserId: row.reservedForUserId as string | null,
    listingType: row.listingType as ListingType,
    stockQuantity: row.stockQuantity,
    shipsWithinDays: row.shipsWithinDays,
    processingTimeMinDays: row.processingTimeMinDays,
    processingTimeMaxDays: row.processingTimeMaxDays,
    category: row.category as Category | null,
    tags: Object.freeze([...row.tags]),
    materials: Object.freeze([...row.materials]),
    productLengthIn: row.productLengthIn,
    productWidthIn: row.productWidthIn,
    productHeightIn: row.productHeightIn,
    metroId: row.metroId as string | null,
    cityMetroId: row.cityMetroId as string | null,
    photos,
    variantGroups,
    metro,
    cityMetro,
  });
}

async function readActorDetail(
  client: ActorListingDetailClient,
  listingId: string,
) {
  const rows = await client.$queryRaw<ListingDetailSourceRow[]>`
    SELECT *
      FROM public.grainline_listing_actor_detail_source(${listingId}::text)
  `;
  return parseListingDetailSource(rows, listingId);
}

export async function listingActorDetailSource(
  viewerUserId: string | null,
  listingId: string,
) {
  if (!validId(listingId)) {
    return null;
  }
  if (viewerUserId !== null) {
    if (!validId(viewerUserId)) {
      throw new RangeError("Listing detail viewer is outside the supported range");
    }
    return withDbUserContext(
      viewerUserId,
      (client) => readActorDetail(client, listingId),
    );
  }
  return readActorDetail(prisma, listingId);
}

export async function listingStaffDetailSource(
  client: StaffListingDetailClient,
  actorUserId: string,
  listingId: string,
) {
  if (!validId(actorUserId) || !validId(listingId)) {
    throw new RangeError("Listing detail staff input is outside the supported range");
  }
  const rows = await client.$queryRaw<ListingDetailSourceRow[]>`
    SELECT *
      FROM public.grainline_listing_staff_detail_source(
        ${actorUserId}::text,
        ${listingId}::text
      )
  `;
  return parseListingDetailSource(rows, listingId);
}
