import { Category, ListingStatus, ListingType, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  withDbUserContext,
  type DbUserContextTransactionClient,
} from "@/lib/dbUserContext";
import { syncListingDirectUploadReferences } from "@/lib/directUploadLifecycle";
import { isTextWithinCodePointRange } from "@/lib/textLength";

type ListingOwnerClient = Pick<Prisma.TransactionClient, "$queryRaw">;

type ListingOwnerAiReviewContextRow = {
  sellerProfileId: unknown;
  listingUpdatedAt: unknown;
  recentTitles: unknown;
  photoUrls: unknown;
};

type ListingOwnerEditorRow = {
  listingId: unknown;
  sellerProfileId: unknown;
  title: unknown;
  description: unknown;
  priceCents: unknown;
  priceVersion: unknown;
  currency: unknown;
  status: unknown;
  createdAt: unknown;
  updatedAt: unknown;
  archivedAt: unknown;
  processingTimeMinDays: unknown;
  processingTimeMaxDays: unknown;
  listingType: unknown;
  stockQuantity: unknown;
  category: unknown;
  tags: unknown;
  shipsWithinDays: unknown;
  packagedWeightGrams: unknown;
  packagedLengthCm: unknown;
  packagedWidthCm: unknown;
  packagedHeightCm: unknown;
  isPrivate: unknown;
  reservedForUserId: unknown;
  customOrderConversationId: unknown;
  rejectionReason: unknown;
  metaDescription: unknown;
  materials: unknown;
  productLengthIn: unknown;
  productWidthIn: unknown;
  productHeightIn: unknown;
  photos: unknown;
  variantGroups: unknown;
};

type ListingOwnerContentUpdateRow = {
  applied: unknown;
  title: unknown;
  updatedAt: unknown;
  requiresReview: unknown;
  approvedStatus: unknown;
};

type ListingOwnerCreateRow = {
  created: unknown;
  id: unknown;
  title: unknown;
  description: unknown;
  priceCents: unknown;
  currency: unknown;
  status: unknown;
  updatedAt: unknown;
  category: unknown;
  tags: unknown;
};

type ListingOwnerRatingBucketRow = {
  bucketEpochMillis: unknown;
  averageRating: unknown;
  reviewCount: unknown;
};

export type ListingOwnerRatingBucket = Readonly<{
  date: Date;
  averageRating: number;
  reviewCount: number;
}>;

export type ListingOwnerPhotoInput = Readonly<{
  id?: string | null;
  url: string;
  originalUrl: string;
  altText: string | null;
}>;

export type ListingOwnerVariantGroupInput = Readonly<{
  name: string;
  options: ReadonlyArray<Readonly<{
    label: string;
    priceAdjustCents: number;
    inStock: boolean;
  }>>;
}>;

export type ListingOwnerCreateState = Readonly<{
  id: string;
  title: string;
  description: string;
  priceCents: number;
  currency: string;
  status: ListingStatus;
  updatedAt: Date;
  category: Category | null;
  tags: ReadonlyArray<string>;
}>;

type ListingOwnerDeleteLockRow = {
  id: unknown;
  sellerId: unknown;
  status: unknown;
  isPrivate: unknown;
  archivedAt: unknown;
  customOrderConversationId: unknown;
  updatedAt: unknown;
};

type ListingOwnerArchiveRow = {
  applied: unknown;
  updatedAt: unknown;
  archivedAt: unknown;
};

type ListingOwnerHardDeleteRow = {
  applied: unknown;
  removedPhotos: unknown;
};

export type ListingOwnerEditorState = Readonly<{
  id: string;
  sellerId: string;
  title: string;
  description: string;
  priceCents: number;
  priceVersion: number;
  currency: string;
  status: ListingStatus;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  processingTimeMinDays: number | null;
  processingTimeMaxDays: number | null;
  listingType: ListingType;
  stockQuantity: number | null;
  category: Category | null;
  tags: ReadonlyArray<string>;
  shipsWithinDays: number | null;
  packagedWeightGrams: number | null;
  packagedLengthCm: number | null;
  packagedWidthCm: number | null;
  packagedHeightCm: number | null;
  isPrivate: boolean;
  reservedForUserId: string | null;
  customOrderConversationId: string | null;
  rejectionReason: string | null;
  metaDescription: string | null;
  materials: ReadonlyArray<string>;
  productLengthIn: number | null;
  productWidthIn: number | null;
  productHeightIn: number | null;
  photos: ReadonlyArray<Readonly<{
    id: string;
    url: string;
    originalUrl: string | null;
    altText: string | null;
    sortOrder: number;
  }>>;
  variantGroups: ReadonlyArray<Readonly<{
    id: string;
    name: string;
    sortOrder: number;
    options: ReadonlyArray<Readonly<{
      id: string;
      label: string;
      priceAdjustCents: number;
      sortOrder: number;
      inStock: boolean;
    }>>;
  }>>;
}>;

type ListingOwnerExportRow = {
  id: unknown;
  title: unknown;
  description: unknown;
  priceCents: unknown;
  priceVersion: unknown;
  currency: unknown;
  status: unknown;
  videoUrl: unknown;
  isPrivate: unknown;
  listingType: unknown;
  stockQuantity: unknown;
  processingTimeMinDays: unknown;
  processingTimeMaxDays: unknown;
  shipsWithinDays: unknown;
  category: unknown;
  tags: unknown;
  packagedWeightGrams: unknown;
  packagedLengthCm: unknown;
  packagedWidthCm: unknown;
  packagedHeightCm: unknown;
  reservedForUserId: unknown;
  customOrderConversationId: unknown;
  metaDescription: unknown;
  materials: unknown;
  productLengthIn: unknown;
  productWidthIn: unknown;
  productHeightIn: unknown;
  createdAt: unknown;
  updatedAt: unknown;
  photos: unknown;
  variantGroups: unknown;
};

export type ListingOwnerExportState = Readonly<{
  id: string;
  title: string;
  description: string;
  priceCents: number;
  priceVersion: number;
  currency: string;
  status: ListingStatus;
  videoUrl: string | null;
  isPrivate: boolean;
  listingType: ListingType;
  stockQuantity: number | null;
  processingTimeMinDays: number | null;
  processingTimeMaxDays: number | null;
  shipsWithinDays: number | null;
  category: Category | null;
  tags: ReadonlyArray<string>;
  packagedWeightGrams: number | null;
  packagedLengthCm: number | null;
  packagedWidthCm: number | null;
  packagedHeightCm: number | null;
  reservedForUserId: string | null;
  customOrderConversationId: string | null;
  metaDescription: string | null;
  materials: ReadonlyArray<string>;
  productLengthIn: number | null;
  productWidthIn: number | null;
  productHeightIn: number | null;
  createdAt: Date;
  updatedAt: Date;
  photos: ReadonlyArray<Readonly<{
    url: string;
    originalUrl: string | null;
    altText: string | null;
    sortOrder: number;
  }>>;
  variantGroups: ReadonlyArray<Readonly<{
    name: string;
    sortOrder: number;
    options: ReadonlyArray<Readonly<{
      label: string;
      priceAdjustCents: number;
      sortOrder: number;
      inStock: boolean;
    }>>;
  }>>;
}>;

type ListingOwnerSummaryRow = {
  id: unknown;
  title: unknown;
  priceCents: unknown;
  currency: unknown;
  status: unknown;
  isPrivate: unknown;
  listingType: unknown;
  stockQuantity: unknown;
  viewCount: unknown;
  clickCount: unknown;
  favoriteCount: unknown;
  aiReviewFlags: unknown;
  reviewedByAdmin: unknown;
  createdAt: unknown;
  updatedAt: unknown;
  archivedAt: unknown;
  photos: unknown;
};

type ListingOwnerCountsRow = {
  draftCount: unknown;
  activeCount: unknown;
  activePublicCount: unknown;
  oldestListingId: unknown;
};

type ListingOwnerWorkshopSummaryRow = {
  listingCount: unknown;
  statusCounts: unknown;
  inStockCount: unknown;
  underReviewTitle: unknown;
  lowStock: unknown;
};

type ListingOwnerActionStateRow = {
  listingId: unknown;
  sellerProfileId: unknown;
  title: unknown;
  description: unknown;
  priceCents: unknown;
  currency: unknown;
  status: unknown;
  updatedAt: unknown;
  archivedAt: unknown;
  listingType: unknown;
  stockQuantity: unknown;
  category: unknown;
  tags: unknown;
  isPrivate: unknown;
  reservedForUserId: unknown;
  customOrderConversationId: unknown;
  rejectionReason: unknown;
};

type ListingOwnerTransitionRow = {
  applied: unknown;
};

type ListingOwnerMetroAssignmentRow = {
  applied: unknown;
  updatedAt: unknown;
};

export type ListingOwnerTransitionOperation =
  | "HIDE"
  | "MARK_SOLD"
  | "WITHDRAW_REVIEW"
  | "RETURN_TO_DRAFT";

export type ListingOwnerSummaryState = Readonly<{
  id: string;
  title: string;
  priceCents: number;
  currency: string;
  status: ListingStatus;
  isPrivate: boolean;
  listingType: ListingType;
  stockQuantity: number | null;
  viewCount: number;
  clickCount: number;
  favoriteCount: number;
  aiReviewFlags: ReadonlyArray<string>;
  reviewedByAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  photos: ReadonlyArray<Readonly<{ url: string }>>;
}>;

export type ListingOwnerSummaryOptions = Readonly<{
  status?: ListingStatus;
  listingType?: ListingType;
  includeArchived?: boolean;
  skip?: number;
  take?: number;
}>;

export type ListingOwnerWorkshopSummary = Readonly<{
  listingCount: number;
  statusCounts: Readonly<Record<string, number>>;
  inStock: number;
  underReviewTitle: string | null;
  lowStock: ReadonlyArray<Readonly<{
    title: string;
    stockQuantity: number;
  }>>;
}>;

export type ListingOwnerCountsState = Readonly<{
  draftCount: number;
  activeCount: number;
  activePublicCount: number;
  oldestListingId: string | null;
}>;

export type ListingOwnerActionState = Readonly<{
  id: string;
  sellerId: string;
  title: string;
  description: string;
  priceCents: number;
  currency: string;
  status: ListingStatus;
  updatedAt: Date;
  archivedAt: Date | null;
  listingType: ListingType;
  stockQuantity: number | null;
  category: Category | null;
  tags: ReadonlyArray<string>;
  isPrivate: boolean;
  reservedForUserId: string | null;
  customOrderConversationId: string | null;
  rejectionReason: string | null;
}>;

export type ListingOwnerDeleteState = Readonly<{
  id: string;
  sellerId: string;
  status: ListingStatus;
  isPrivate: boolean;
  archivedAt: Date | null;
  customOrderConversationId: string | null;
  updatedAt: Date;
}>;

const LISTING_STATUSES = new Set<string>(Object.values(ListingStatus));
const LISTING_TYPES = new Set<string>(Object.values(ListingType));
const CATEGORIES = new Set<string>(Object.values(Category));

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/u.test(value);
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function validCount(value: unknown): value is bigint {
  return typeof value === "bigint"
    && value >= 0n
    && value <= BigInt(Number.MAX_SAFE_INTEGER);
}

function validNullableSafeInteger(value: unknown): value is number | null {
  return value === null || validSafeInteger(value);
}

function validNullableFinite(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function validNullableNonnegativeNumber(value: unknown): value is number | null {
  return value === null
    || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function validNullableNonnegativeInteger(value: unknown): value is number | null {
  return value === null || (validSafeInteger(value) && value >= 0);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function buildListingChildManifests(
  photos: ReadonlyArray<ListingOwnerPhotoInput>,
  variantGroups: ReadonlyArray<ListingOwnerVariantGroupInput>,
  basePriceCents: number,
  allowEmptyPhotos = false,
) {
  if (
    (!allowEmptyPhotos && photos.length < 1)
    || photos.length > 10
    || variantGroups.length > 3
    || !validSafeInteger(basePriceCents)
    || basePriceCents < 1
    || basePriceCents > 10_000_000
  ) {
    throw new RangeError("Listing child manifest is invalid");
  }

  const photoIds = new Set<string>();
  const photoManifest = photos.map((photo, sortOrder) => {
    const id = photo.id ?? randomUUID();
    if (
      !validId(id)
      || photoIds.has(id)
      || !isTextWithinCodePointRange(photo.url, 1, 2048)
      || !isTextWithinCodePointRange(photo.originalUrl, 1, 2048)
      || !(photo.altText === null || isTextWithinCodePointRange(photo.altText, 0, 200))
    ) {
      throw new RangeError("Listing photo manifest is invalid");
    }
    photoIds.add(id);
    return Object.freeze({
      id,
      url: photo.url,
      originalUrl: photo.originalUrl,
      altText: photo.altText,
      sortOrder,
    });
  });

  const groupIds = new Set<string>();
  const optionIds = new Set<string>();
  let minimumAdjustment = 0;
  let maximumAdjustment = 0;
  const variantManifest = variantGroups.map((group, sortOrder) => {
    const id = randomUUID();
    if (
      groupIds.has(id)
      || !isTextWithinCodePointRange(group.name, 1, 50)
      || group.options.length < 1
      || group.options.length > 10
    ) {
      throw new RangeError("Listing variant manifest is invalid");
    }
    groupIds.add(id);
    let groupMinimum = Number.POSITIVE_INFINITY;
    let groupMaximum = Number.NEGATIVE_INFINITY;
    const options = group.options.map((option, optionSortOrder) => {
      const optionId = randomUUID();
      if (
        optionIds.has(optionId)
        || !isTextWithinCodePointRange(option.label, 1, 50)
        || !validSafeInteger(option.priceAdjustCents)
        || option.priceAdjustCents < -10_000_000
        || option.priceAdjustCents > 10_000_000
        || typeof option.inStock !== "boolean"
      ) {
        throw new RangeError("Listing variant manifest is invalid");
      }
      optionIds.add(optionId);
      groupMinimum = Math.min(groupMinimum, option.priceAdjustCents);
      groupMaximum = Math.max(groupMaximum, option.priceAdjustCents);
      return Object.freeze({
        id: optionId,
        label: option.label,
        priceAdjustCents: option.priceAdjustCents,
        sortOrder: optionSortOrder,
        inStock: option.inStock,
      });
    });
    minimumAdjustment += groupMinimum;
    maximumAdjustment += groupMaximum;
    return Object.freeze({ id, name: group.name, sortOrder, options });
  });

  if (
    basePriceCents + minimumAdjustment < 1
    || basePriceCents + maximumAdjustment > 10_000_000
  ) {
    throw new RangeError("Listing variant prices are invalid");
  }

  return Object.freeze({
    photos: JSON.stringify(photoManifest),
    variantGroups: JSON.stringify(variantManifest),
  });
}

function parsePhotos(value: unknown) {
  if (!Array.isArray(value) || value.length > 100) return null;
  const ids = new Set<string>();
  const photos = value.map((candidate) => {
    const photo = recordValue(candidate);
    if (
      !photo
      || !validId(photo.id)
      || ids.has(photo.id)
      || !isTextWithinCodePointRange(photo.url, 1, 2048)
      || (photo.originalUrl !== null && !isTextWithinCodePointRange(photo.originalUrl, 1, 2048))
      || (photo.altText !== null && !isTextWithinCodePointRange(photo.altText, 0, 200))
      || !validSafeInteger(photo.sortOrder)
    ) return null;
    ids.add(photo.id);
    return Object.freeze({
      id: photo.id,
      url: photo.url,
      originalUrl: photo.originalUrl as string | null,
      altText: photo.altText as string | null,
      sortOrder: photo.sortOrder,
    });
  });
  return photos.some((photo) => photo === null)
    ? null
    : Object.freeze(photos as Array<NonNullable<(typeof photos)[number]>>);
}

function parseVariantGroups(value: unknown) {
  if (!Array.isArray(value) || value.length > 100) return null;
  const groupIds = new Set<string>();
  const groups = value.map((candidate) => {
    const group = recordValue(candidate);
    if (
      !group
      || !validId(group.id)
      || groupIds.has(group.id)
      || !isTextWithinCodePointRange(group.name, 1, 100)
      || !validSafeInteger(group.sortOrder)
      || !Array.isArray(group.options)
      || group.options.length > 100
    ) return null;
    const optionIds = new Set<string>();
    const options = group.options.map((optionCandidate) => {
      const option = recordValue(optionCandidate);
      if (
        !option
        || !validId(option.id)
        || optionIds.has(option.id)
        || !isTextWithinCodePointRange(option.label, 1, 100)
        || !validSafeInteger(option.priceAdjustCents)
        || !validSafeInteger(option.sortOrder)
        || typeof option.inStock !== "boolean"
      ) return null;
      optionIds.add(option.id);
      return Object.freeze({
        id: option.id,
        label: option.label,
        priceAdjustCents: option.priceAdjustCents,
        sortOrder: option.sortOrder,
        inStock: option.inStock,
      });
    });
    if (options.some((option) => option === null)) return null;
    groupIds.add(group.id);
    return Object.freeze({
      id: group.id,
      name: group.name,
      sortOrder: group.sortOrder,
      options: Object.freeze(options as Array<NonNullable<(typeof options)[number]>>),
    });
  });
  return groups.some((group) => group === null)
    ? null
    : Object.freeze(groups as Array<NonNullable<(typeof groups)[number]>>);
}

async function readListingOwnerEditor(
  client: ListingOwnerClient,
  listingId: string,
): Promise<ListingOwnerEditorState | null> {
  if (!validId(listingId)) {
    throw new RangeError("Listing owner-editor input is invalid");
  }
  const rows = await client.$queryRaw<ListingOwnerEditorRow[]>`
    SELECT * FROM public.grainline_listing_owner_editor(${listingId}::text)
  `;
  if (rows.length === 0) return null;
  if (rows.length !== 1) {
    throw new Error("Listing owner-editor authority returned multiple rows");
  }
  const row = rows[0];
  const photos = parsePhotos(row.photos);
  const variantGroups = parseVariantGroups(row.variantGroups);
  const validNullableId = (value: unknown) => value === null || validId(value);
  if (
    row.listingId !== listingId
    || !validId(row.sellerProfileId)
    || !isTextWithinCodePointRange(row.title, 1, 150)
    || !isTextWithinCodePointRange(row.description, 0, 5000)
    || !validSafeInteger(row.priceCents)
    || row.priceCents < 1
    || !validSafeInteger(row.priceVersion)
    || row.priceVersion < 1
    || typeof row.currency !== "string"
    || row.currency.length !== 3
    || typeof row.status !== "string"
    || !LISTING_STATUSES.has(row.status)
    || !validDate(row.createdAt)
    || !validDate(row.updatedAt)
    || row.archivedAt !== null
    || !validNullableSafeInteger(row.processingTimeMinDays)
    || !validNullableSafeInteger(row.processingTimeMaxDays)
    || typeof row.listingType !== "string"
    || !LISTING_TYPES.has(row.listingType)
    || !validNullableSafeInteger(row.stockQuantity)
    || (row.category !== null && (typeof row.category !== "string" || !CATEGORIES.has(row.category)))
    || !Array.isArray(row.tags)
    || !row.tags.every((tag) => isTextWithinCodePointRange(tag, 0, 100))
    || !validNullableSafeInteger(row.shipsWithinDays)
    || !validNullableSafeInteger(row.packagedWeightGrams)
    || !validNullableFinite(row.packagedLengthCm)
    || !validNullableFinite(row.packagedWidthCm)
    || !validNullableFinite(row.packagedHeightCm)
    || typeof row.isPrivate !== "boolean"
    || !validNullableId(row.reservedForUserId)
    || !validNullableId(row.customOrderConversationId)
    || (row.rejectionReason !== null && !isTextWithinCodePointRange(row.rejectionReason, 0, 1000))
    || (row.metaDescription !== null && !isTextWithinCodePointRange(row.metaDescription, 0, 320))
    || !Array.isArray(row.materials)
    || row.materials.length > 20
    || !row.materials.every((material) => typeof material === "string")
    || !validNullableFinite(row.productLengthIn)
    || !validNullableFinite(row.productWidthIn)
    || !validNullableFinite(row.productHeightIn)
    || photos === null
    || variantGroups === null
  ) {
    throw new Error("Listing owner-editor authority returned an invalid result");
  }
  return Object.freeze({
    id: row.listingId,
    sellerId: row.sellerProfileId,
    title: row.title,
    description: row.description,
    priceCents: row.priceCents,
    priceVersion: row.priceVersion,
    currency: row.currency,
    status: row.status as ListingStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: null,
    processingTimeMinDays: row.processingTimeMinDays,
    processingTimeMaxDays: row.processingTimeMaxDays,
    listingType: row.listingType as ListingType,
    stockQuantity: row.stockQuantity,
    category: row.category as Category | null,
    tags: Object.freeze([...row.tags]),
    shipsWithinDays: row.shipsWithinDays,
    packagedWeightGrams: row.packagedWeightGrams,
    packagedLengthCm: row.packagedLengthCm,
    packagedWidthCm: row.packagedWidthCm,
    packagedHeightCm: row.packagedHeightCm,
    isPrivate: row.isPrivate,
    reservedForUserId: row.reservedForUserId as string | null,
    customOrderConversationId: row.customOrderConversationId as string | null,
    rejectionReason: row.rejectionReason as string | null,
    metaDescription: row.metaDescription as string | null,
    materials: Object.freeze([...row.materials]),
    productLengthIn: row.productLengthIn,
    productWidthIn: row.productWidthIn,
    productHeightIn: row.productHeightIn,
    photos,
    variantGroups,
  });
}

export function listingOwnerEditor(userId: string, listingId: string) {
  if (!validId(listingId)) return Promise.resolve(null);
  return withDbUserContext(
    userId,
    (client) => readListingOwnerEditor(client, listingId),
  );
}

async function readListingOwnerAiReviewContext(
  client: ListingOwnerClient,
  listingId: string,
) {
  if (!validId(listingId)) {
    throw new RangeError("Listing owner AI-review context input is invalid");
  }
  const rows = await client.$queryRaw<ListingOwnerAiReviewContextRow[]>`
    SELECT *
      FROM public.grainline_listing_owner_ai_review_context(${listingId}::text)
  `;
  if (rows.length === 0) return null;
  if (rows.length !== 1) {
    throw new Error("Listing owner AI-review context authority returned multiple rows");
  }
  const row = rows[0];
  if (
    !validId(row.sellerProfileId)
    || !validDate(row.listingUpdatedAt)
    || !Array.isArray(row.recentTitles)
    || row.recentTitles.some((title) => !isTextWithinCodePointRange(title, 1, 150))
    || !Array.isArray(row.photoUrls)
    || row.photoUrls.length > 10
    || row.photoUrls.some((url) => !isTextWithinCodePointRange(url, 1, 2048))
  ) {
    throw new Error("Listing owner AI-review context authority returned an invalid result");
  }
  return Object.freeze({
    sellerProfileId: row.sellerProfileId,
    listingUpdatedAt: row.listingUpdatedAt,
    recentTitles: Object.freeze([...row.recentTitles]),
    photoUrls: Object.freeze([...row.photoUrls]),
  });
}

export function listingOwnerAiReviewContext(userId: string, listingId: string) {
  return withDbUserContext(
    userId,
    (client) => readListingOwnerAiReviewContext(client, listingId),
  );
}

async function readListingOwnerActionState(
  client: ListingOwnerClient,
  listingId: string,
): Promise<ListingOwnerActionState | null> {
  if (!validId(listingId)) {
    throw new RangeError("Listing owner action-state input is invalid");
  }
  const rows = await client.$queryRaw<ListingOwnerActionStateRow[]>`
    SELECT *
      FROM public.grainline_listing_owner_action_state(${listingId}::text)
  `;
  if (rows.length === 0) return null;
  if (rows.length !== 1) {
    throw new Error("Listing owner action-state authority returned multiple rows");
  }
  const row = rows[0];
  const validNullableId = (value: unknown) => value === null || validId(value);
  if (
    row.listingId !== listingId
    || !validId(row.sellerProfileId)
    || !isTextWithinCodePointRange(row.title, 1, 150)
    || !isTextWithinCodePointRange(row.description, 0, 5000)
    || !validSafeInteger(row.priceCents)
    || row.priceCents < 1
    || typeof row.currency !== "string"
    || row.currency.length !== 3
    || typeof row.status !== "string"
    || !LISTING_STATUSES.has(row.status)
    || !validDate(row.updatedAt)
    || !(row.archivedAt === null || validDate(row.archivedAt))
    || typeof row.listingType !== "string"
    || !LISTING_TYPES.has(row.listingType)
    || !validNullableSafeInteger(row.stockQuantity)
    || (row.stockQuantity !== null && row.stockQuantity < 0)
    || (row.category !== null && (typeof row.category !== "string" || !CATEGORIES.has(row.category)))
    || !Array.isArray(row.tags)
    || row.tags.length > 10
    || !row.tags.every((tag) => isTextWithinCodePointRange(tag, 0, 100))
    || typeof row.isPrivate !== "boolean"
    || !validNullableId(row.reservedForUserId)
    || !validNullableId(row.customOrderConversationId)
    || (row.rejectionReason !== null && !isTextWithinCodePointRange(row.rejectionReason, 0, 1000))
  ) {
    throw new Error("Listing owner action-state authority returned an invalid result");
  }
  return Object.freeze({
    id: row.listingId,
    sellerId: row.sellerProfileId,
    title: row.title,
    description: row.description,
    priceCents: row.priceCents,
    currency: row.currency,
    status: row.status as ListingStatus,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt as Date | null,
    listingType: row.listingType as ListingType,
    stockQuantity: row.stockQuantity,
    category: row.category as Category | null,
    tags: Object.freeze([...row.tags]),
    isPrivate: row.isPrivate,
    reservedForUserId: row.reservedForUserId as string | null,
    customOrderConversationId: row.customOrderConversationId as string | null,
    rejectionReason: row.rejectionReason as string | null,
  });
}

export function listingOwnerActionState(userId: string, listingId: string) {
  return withDbUserContext(
    userId,
    (client) => readListingOwnerActionState(client, listingId),
  );
}

export function assignListingOwnerMetros(
  userId: string,
  input: Readonly<{
    listingId: string;
    expectedUpdatedAt: Date;
    metroId: string;
    cityMetroId: string | null;
  }>,
) {
  if (
    !validId(input.listingId)
    || !validDate(input.expectedUpdatedAt)
    || !validId(input.metroId)
    || !(input.cityMetroId === null || validId(input.cityMetroId))
  ) {
    throw new RangeError("Listing owner metro-assignment input is invalid");
  }

  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<ListingOwnerMetroAssignmentRow[]>`
      SELECT *
        FROM public.grainline_listing_owner_assign_metros(
          ${input.listingId}::text,
          ${input.expectedUpdatedAt}::timestamp,
          ${input.metroId}::text,
          ${input.cityMetroId}::text
        )
    `;
    const row = rows[0];
    if (
      rows.length !== 1
      || typeof row?.applied !== "boolean"
      || (
        row.applied
          ? !(row.updatedAt instanceof Date && Number.isFinite(row.updatedAt.getTime()))
          : row.updatedAt !== null
      )
    ) {
      throw new Error("Listing owner metro-assignment authority returned an invalid result");
    }
    return row.applied
      ? Object.freeze({ applied: true as const, updatedAt: row.updatedAt as Date })
      : Object.freeze({ applied: false as const, updatedAt: null });
  });
}

export function createListingOwner(
  userId: string,
  input: Readonly<{
    status: ListingStatus;
    isPrivate: boolean;
    reservedForUserId: string | null;
    customOrderConversationId: string | null;
    title: string;
    description: string;
    priceCents: number;
    tags: ReadonlyArray<string>;
    metaDescription: string | null;
    materials: ReadonlyArray<string>;
    productLengthIn: number | null;
    productWidthIn: number | null;
    productHeightIn: number | null;
    packagedLengthCm: number | null;
    packagedWidthCm: number | null;
    packagedHeightCm: number | null;
    packagedWeightGrams: number | null;
    category: Category | null;
    listingType: ListingType;
    stockQuantity: number | null;
    shipsWithinDays: number | null;
    processingTimeMinDays: number | null;
    processingTimeMaxDays: number | null;
    photos: ReadonlyArray<ListingOwnerPhotoInput>;
    variantGroups: ReadonlyArray<ListingOwnerVariantGroupInput>;
  }>,
): Promise<ListingOwnerCreateState | null> {
  const boundedNullableDays = (value: number | null) =>
    value === null || (validSafeInteger(value) && value >= 1 && value <= 365);
  if (
    !validId(userId)
    || (input.status !== ListingStatus.DRAFT && input.status !== ListingStatus.PENDING_REVIEW)
    || typeof input.isPrivate !== "boolean"
    || !isTextWithinCodePointRange(input.title, 1, 150)
    || !isTextWithinCodePointRange(input.description, 0, 5000)
    || !validSafeInteger(input.priceCents)
    || input.priceCents < 1
    || input.priceCents > 10_000_000
    || !Array.isArray(input.tags)
    || input.tags.length > 10
    || !input.tags.every((tag) => isTextWithinCodePointRange(tag, 0, 100))
    || !(input.metaDescription === null || isTextWithinCodePointRange(input.metaDescription, 0, 160))
    || !Array.isArray(input.materials)
    || input.materials.length > 20
    || !input.materials.every((material) => isTextWithinCodePointRange(material, 1, 100))
    || !validNullableNonnegativeNumber(input.productLengthIn)
    || !validNullableNonnegativeNumber(input.productWidthIn)
    || !validNullableNonnegativeNumber(input.productHeightIn)
    || !validNullableNonnegativeNumber(input.packagedLengthCm)
    || !validNullableNonnegativeNumber(input.packagedWidthCm)
    || !validNullableNonnegativeNumber(input.packagedHeightCm)
    || !validNullableNonnegativeInteger(input.packagedWeightGrams)
    || !(input.category === null || CATEGORIES.has(input.category))
    || !LISTING_TYPES.has(input.listingType)
    || !validNullableSafeInteger(input.stockQuantity)
    || !boundedNullableDays(input.shipsWithinDays)
    || !boundedNullableDays(input.processingTimeMinDays)
    || !boundedNullableDays(input.processingTimeMaxDays)
    || (
      input.processingTimeMinDays !== null
      && input.processingTimeMaxDays !== null
      && input.processingTimeMinDays > input.processingTimeMaxDays
    )
    || (
      input.listingType === ListingType.IN_STOCK
      && (
        input.stockQuantity === null
        || input.stockQuantity < 1
        || input.stockQuantity > 1_000_000
        || input.processingTimeMinDays !== null
        || input.processingTimeMaxDays !== null
      )
    )
    || (
      input.listingType === ListingType.MADE_TO_ORDER
      && (input.stockQuantity !== null || input.shipsWithinDays !== null)
    )
    || (
      !input.isPrivate
      && (input.reservedForUserId !== null || input.customOrderConversationId !== null)
    )
    || (
      input.isPrivate
      && (
        input.status !== ListingStatus.PENDING_REVIEW
        || !validId(input.reservedForUserId)
        || !validId(input.customOrderConversationId)
        || input.variantGroups.length !== 0
      )
    )
  ) {
    throw new RangeError("Listing owner-create input is invalid");
  }

  const listingId = randomUUID();
  const manifests = buildListingChildManifests(
    input.photos,
    input.variantGroups,
    input.priceCents,
    input.isPrivate,
  );
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<ListingOwnerCreateRow[]>`
      SELECT *
        FROM public.grainline_listing_owner_create(
          ${listingId}::text,
          ${input.status}::text,
          ${input.isPrivate}::boolean,
          ${input.reservedForUserId}::text,
          ${input.customOrderConversationId}::text,
          ${input.title}::text,
          ${input.description}::text,
          ${input.priceCents}::integer,
          ${[...input.tags]}::text[],
          ${input.metaDescription}::text,
          ${[...input.materials]}::text[],
          ${input.productLengthIn}::double precision,
          ${input.productWidthIn}::double precision,
          ${input.productHeightIn}::double precision,
          ${input.packagedLengthCm}::double precision,
          ${input.packagedWidthCm}::double precision,
          ${input.packagedHeightCm}::double precision,
          ${input.packagedWeightGrams}::integer,
          ${input.category}::text,
          ${input.listingType}::text,
          ${input.stockQuantity}::integer,
          ${input.shipsWithinDays}::integer,
          ${input.processingTimeMinDays}::integer,
          ${input.processingTimeMaxDays}::integer,
          ${manifests.photos}::jsonb,
          ${manifests.variantGroups}::jsonb
        )
    `;
    const row = rows[0];
    const validCreated =
      row?.created === true
      && row.id === listingId
      && row.title === input.title
      && row.description === input.description
      && row.priceCents === input.priceCents
      && row.currency === "usd"
      && row.status === input.status
      && validDate(row.updatedAt)
      && row.category === input.category
      && Array.isArray(row.tags)
      && row.tags.length === input.tags.length
      && row.tags.every((tag, index) => tag === input.tags[index]);
    const validRejected =
      row?.created === false
      && row.id === null
      && row.title === null
      && row.description === null
      && row.priceCents === null
      && row.currency === null
      && row.status === null
      && row.updatedAt === null
      && row.category === null
      && row.tags === null;
    if (rows.length !== 1 || (!validCreated && !validRejected)) {
      throw new Error("Listing owner-create authority returned an invalid result");
    }
    if (!row.created) return null;
    await syncListingDirectUploadReferences({
      client,
      userId,
      listingId,
      requireAllTracked: true,
    });
    return Object.freeze({
      id: row.id as string,
      title: row.title as string,
      description: row.description as string,
      priceCents: row.priceCents as number,
      currency: row.currency as string,
      status: row.status as ListingStatus,
      updatedAt: row.updatedAt as Date,
      category: row.category as Category | null,
      tags: Object.freeze([...(row.tags as string[])]),
    });
  });
}

export async function updateListingOwnerContent(
  client: DbUserContextTransactionClient,
  input: Readonly<{
    listingId: string;
    expectedUpdatedAt: Date;
    expectedStatus: ListingStatus;
    expectedListingType: ListingType;
    title: string;
    description: string;
    priceCents: number;
    incrementPriceVersion: boolean;
    tags: ReadonlyArray<string>;
    metaDescription: string | null;
    materials: ReadonlyArray<string>;
    productLengthIn: number | null;
    productWidthIn: number | null;
    productHeightIn: number | null;
    packagedLengthCm: number | null;
    packagedWidthCm: number | null;
    packagedHeightCm: number | null;
    packagedWeightGrams: number | null;
    category: Category | null;
    listingType: ListingType;
    stockQuantity: number | null;
    shipsWithinDays: number | null;
    processingTimeMinDays: number | null;
    processingTimeMaxDays: number | null;
    photos: ReadonlyArray<ListingOwnerPhotoInput>;
    variantGroups: ReadonlyArray<ListingOwnerVariantGroupInput>;
  }>,
) {
  const editableStatuses = new Set<ListingStatus>([
    ListingStatus.DRAFT,
    ListingStatus.ACTIVE,
    ListingStatus.SOLD_OUT,
    ListingStatus.HIDDEN,
    ListingStatus.REJECTED,
  ]);
  const boundedNullableDays = (value: number | null) =>
    value === null || (Number.isSafeInteger(value) && value >= 1 && value <= 365);
  if (
    !validId(input.listingId)
    || !validDate(input.expectedUpdatedAt)
    || !editableStatuses.has(input.expectedStatus)
    || !LISTING_TYPES.has(input.expectedListingType)
    || !isTextWithinCodePointRange(input.title, 1, 150)
    || !isTextWithinCodePointRange(input.description, 0, 5000)
    || !validSafeInteger(input.priceCents)
    || input.priceCents < 1
    || input.priceCents > 10_000_000
    || typeof input.incrementPriceVersion !== "boolean"
    || !Array.isArray(input.tags)
    || input.tags.length > 10
    || !input.tags.every((tag) => isTextWithinCodePointRange(tag, 0, 100))
    || !(
      input.metaDescription === null
      || isTextWithinCodePointRange(input.metaDescription, 0, 160)
    )
    || !Array.isArray(input.materials)
    || input.materials.length > 20
    || !input.materials.every((material) =>
      isTextWithinCodePointRange(material, 1, 100)
    )
    || !validNullableNonnegativeNumber(input.productLengthIn)
    || !validNullableNonnegativeNumber(input.productWidthIn)
    || !validNullableNonnegativeNumber(input.productHeightIn)
    || !validNullableNonnegativeNumber(input.packagedLengthCm)
    || !validNullableNonnegativeNumber(input.packagedWidthCm)
    || !validNullableNonnegativeNumber(input.packagedHeightCm)
    || !validNullableNonnegativeInteger(input.packagedWeightGrams)
    || !(input.category === null || CATEGORIES.has(input.category))
    || !LISTING_TYPES.has(input.listingType)
    || !validNullableSafeInteger(input.stockQuantity)
    || !boundedNullableDays(input.shipsWithinDays)
    || !boundedNullableDays(input.processingTimeMinDays)
    || !boundedNullableDays(input.processingTimeMaxDays)
    || (
      input.processingTimeMinDays !== null
      && input.processingTimeMaxDays !== null
      && input.processingTimeMinDays > input.processingTimeMaxDays
    )
    || (
      input.listingType === ListingType.IN_STOCK
      && (
        input.processingTimeMinDays !== null
        || input.processingTimeMaxDays !== null
      )
    )
    || (
      input.listingType === ListingType.MADE_TO_ORDER
      && input.shipsWithinDays !== null
    )
    || (
      input.expectedListingType !== input.listingType
      && input.listingType === ListingType.IN_STOCK
      && (
        input.stockQuantity === null
        || input.stockQuantity < 1
        || input.stockQuantity > 1_000_000
      )
    )
    || (
      input.expectedListingType !== input.listingType
      && input.listingType === ListingType.MADE_TO_ORDER
      && input.stockQuantity !== null
    )
  ) {
    throw new RangeError("Listing owner content-update input is invalid");
  }

  const manifests = buildListingChildManifests(
    input.photos,
    input.variantGroups,
    input.priceCents,
    false,
  );

  const rows = await client.$queryRaw<ListingOwnerContentUpdateRow[]>`
    SELECT *
      FROM public.grainline_listing_owner_content_update(
        ${input.listingId}::text,
        ${input.expectedUpdatedAt}::timestamp,
        ${input.expectedStatus}::text,
        ${input.expectedListingType}::text,
        ${input.title}::text,
        ${input.description}::text,
        ${input.priceCents}::integer,
        ${input.incrementPriceVersion}::boolean,
        ${[...input.tags]}::text[],
        ${input.metaDescription}::text,
        ${[...input.materials]}::text[],
        ${input.productLengthIn}::double precision,
        ${input.productWidthIn}::double precision,
        ${input.productHeightIn}::double precision,
        ${input.packagedLengthCm}::double precision,
        ${input.packagedWidthCm}::double precision,
        ${input.packagedHeightCm}::double precision,
        ${input.packagedWeightGrams}::integer,
        ${input.category}::text,
        ${input.listingType}::text,
        ${input.stockQuantity}::integer,
        ${input.shipsWithinDays}::integer,
        ${input.processingTimeMinDays}::integer,
        ${input.processingTimeMaxDays}::integer,
        ${manifests.photos}::jsonb,
        ${manifests.variantGroups}::jsonb
      )
  `;
  const row = rows[0];
  const validAppliedResult =
    row?.applied === true
    && row.title === input.title
    && validDate(row.updatedAt)
    && typeof row.requiresReview === "boolean"
    && typeof row.approvedStatus === "string"
    && editableStatuses.has(row.approvedStatus as ListingStatus);
  const validRejectedResult =
    row?.applied === false
    && row.title === null
    && row.updatedAt === null
    && row.requiresReview === null
    && row.approvedStatus === null;
  if (rows.length !== 1 || (!validAppliedResult && !validRejectedResult)) {
    throw new Error("Listing owner content-update authority returned an invalid result");
  }
  return row.applied
    ? Object.freeze({
      applied: true as const,
      title: row.title as string,
      updatedAt: row.updatedAt as Date,
      requiresReview: row.requiresReview as boolean,
      approvedStatus: row.approvedStatus as ListingStatus,
    })
    : Object.freeze({
      applied: false as const,
      title: null,
      updatedAt: null,
      requiresReview: null,
      approvedStatus: null,
    });
}

export async function lockListingOwnerDeleteState(
  client: DbUserContextTransactionClient,
  listingId: string,
): Promise<ListingOwnerDeleteState | null> {
  if (!validId(listingId)) {
    throw new RangeError("Listing owner delete-lock input is invalid");
  }
  const rows = await client.$queryRaw<ListingOwnerDeleteLockRow[]>`
    SELECT *
      FROM public.grainline_listing_owner_delete_lock(
        ${listingId}::text
      )
  `;
  if (rows.length === 0) return null;
  const row = rows[0];
  if (
    rows.length !== 1
    || typeof row.id !== "string"
    || row.id !== listingId
    || typeof row.sellerId !== "string"
    || !validId(row.sellerId)
    || typeof row.status !== "string"
    || !LISTING_STATUSES.has(row.status)
    || typeof row.isPrivate !== "boolean"
    || !(
      row.archivedAt === null
      || validDate(row.archivedAt)
    )
    || !nullableText(row.customOrderConversationId)
    || (
      row.customOrderConversationId !== null
      && !validId(row.customOrderConversationId)
    )
    || !validDate(row.updatedAt)
  ) {
    throw new Error("Listing owner delete-lock authority returned an invalid result");
  }
  return Object.freeze({
    id: row.id,
    sellerId: row.sellerId,
    status: row.status as ListingStatus,
    isPrivate: row.isPrivate,
    archivedAt: row.archivedAt as Date | null,
    customOrderConversationId: row.customOrderConversationId as string | null,
    updatedAt: row.updatedAt as Date,
  });
}

export async function archiveListingOwnerDeleteState(
  client: DbUserContextTransactionClient,
  listingId: string,
  expectedUpdatedAt: Date,
): Promise<Readonly<{
  applied: boolean;
  updatedAt: Date | null;
  archivedAt: Date | null;
}>> {
  if (!validId(listingId) || !validDate(expectedUpdatedAt)) {
    throw new RangeError("Listing owner archive input is invalid");
  }
  const rows = await client.$queryRaw<ListingOwnerArchiveRow[]>`
    SELECT *
      FROM public.grainline_listing_owner_archive(
        ${listingId}::text,
        ${expectedUpdatedAt}::timestamp
      )
  `;
  const row = rows[0];
  const validAppliedResult =
    row?.applied === true
    && validDate(row.updatedAt)
    && validDate(row.archivedAt)
    && row.updatedAt.getTime() === row.archivedAt.getTime();
  const validRejectedResult =
    row?.applied === false
    && row.updatedAt === null
    && row.archivedAt === null;
  if (rows.length !== 1 || (!validAppliedResult && !validRejectedResult)) {
    throw new Error("Listing owner archive authority returned an invalid result");
  }
  return row.applied
    ? Object.freeze({
      applied: true,
      updatedAt: row.updatedAt as Date,
      archivedAt: row.archivedAt as Date,
    })
    : Object.freeze({
      applied: false,
      updatedAt: null,
      archivedAt: null,
    });
}

export async function hardDeleteListingOwnerDeleteState(
  client: DbUserContextTransactionClient,
  listingId: string,
  expectedUpdatedAt: Date,
): Promise<Readonly<{
  applied: boolean;
  removedPhotos: number;
}>> {
  if (!validId(listingId) || !validDate(expectedUpdatedAt)) {
    throw new RangeError("Listing owner hard-delete input is invalid");
  }
  const rows = await client.$queryRaw<ListingOwnerHardDeleteRow[]>`
    SELECT *
      FROM public.grainline_listing_owner_hard_delete(
        ${listingId}::text,
        ${expectedUpdatedAt}::timestamp
      )
  `;
  const row = rows[0];
  if (
    rows.length !== 1
    || typeof row?.applied !== "boolean"
    || !Number.isInteger(row.removedPhotos)
    || (row.removedPhotos as number) < 0
    || (!row.applied && row.removedPhotos !== 0)
  ) {
    throw new Error("Listing owner hard-delete authority returned an invalid result");
  }
  return Object.freeze({
    applied: row.applied,
    removedPhotos: row.removedPhotos as number,
  });
}

export function listingOwnerTransition(
  userId: string,
  input: Readonly<{
    listingId: string;
    operation: ListingOwnerTransitionOperation;
    expectedUpdatedAt?: Date | null;
  }>,
) {
  if (
    !validId(input.listingId)
    || !(["HIDE", "MARK_SOLD", "WITHDRAW_REVIEW", "RETURN_TO_DRAFT"] as const).includes(input.operation)
    || (
      input.operation === "WITHDRAW_REVIEW" || input.operation === "RETURN_TO_DRAFT"
        ? !validDate(input.expectedUpdatedAt)
        : input.expectedUpdatedAt != null
    )
  ) {
    throw new RangeError("Listing owner transition input is invalid");
  }
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<ListingOwnerTransitionRow[]>`
      SELECT *
        FROM public.grainline_listing_owner_transition(
          ${input.listingId}::text,
          ${input.operation}::text,
          ${input.expectedUpdatedAt ?? null}::timestamp
        )
    `;
    if (rows.length !== 1 || typeof rows[0]?.applied !== "boolean") {
      throw new Error("Listing owner transition authority returned an invalid result");
    }
    return rows[0].applied;
  });
}

function parseExportPhotos(value: unknown) {
  if (!Array.isArray(value)) return null;
  const photos = value.map((candidate) => {
    const photo = recordValue(candidate);
    if (
      !photo
      || typeof photo.url !== "string"
      || !nullableText(photo.originalUrl)
      || !nullableText(photo.altText)
      || !validSafeInteger(photo.sortOrder)
    ) return null;
    return Object.freeze({
      url: photo.url,
      originalUrl: photo.originalUrl,
      altText: photo.altText,
      sortOrder: photo.sortOrder,
    });
  });
  return photos.some((photo) => photo === null)
    ? null
    : Object.freeze(photos as Array<NonNullable<(typeof photos)[number]>>);
}

function parseExportVariantGroups(value: unknown) {
  if (!Array.isArray(value)) return null;
  const groups = value.map((candidate) => {
    const group = recordValue(candidate);
    if (
      !group
      || typeof group.name !== "string"
      || !validSafeInteger(group.sortOrder)
      || !Array.isArray(group.options)
    ) return null;
    const options = group.options.map((optionCandidate) => {
      const option = recordValue(optionCandidate);
      if (
        !option
        || typeof option.label !== "string"
        || !validSafeInteger(option.priceAdjustCents)
        || !validSafeInteger(option.sortOrder)
        || typeof option.inStock !== "boolean"
      ) return null;
      return Object.freeze({
        label: option.label,
        priceAdjustCents: option.priceAdjustCents,
        sortOrder: option.sortOrder,
        inStock: option.inStock,
      });
    });
    if (options.some((option) => option === null)) return null;
    return Object.freeze({
      name: group.name,
      sortOrder: group.sortOrder,
      options: Object.freeze(options as Array<NonNullable<(typeof options)[number]>>),
    });
  });
  return groups.some((group) => group === null)
    ? null
    : Object.freeze(groups as Array<NonNullable<(typeof groups)[number]>>);
}

function parseListingOwnerExportRow(row: ListingOwnerExportRow): ListingOwnerExportState {
  const photos = parseExportPhotos(row.photos);
  const variantGroups = parseExportVariantGroups(row.variantGroups);
  const validNullableId = (value: unknown) => value === null || validId(value);
  if (
    !validId(row.id)
    || typeof row.title !== "string"
    || typeof row.description !== "string"
    || !validSafeInteger(row.priceCents)
    || !validSafeInteger(row.priceVersion)
    || typeof row.currency !== "string"
    || row.currency.length !== 3
    || typeof row.status !== "string"
    || !LISTING_STATUSES.has(row.status)
    || !nullableText(row.videoUrl)
    || typeof row.isPrivate !== "boolean"
    || typeof row.listingType !== "string"
    || !LISTING_TYPES.has(row.listingType)
    || !validNullableSafeInteger(row.stockQuantity)
    || !validNullableSafeInteger(row.processingTimeMinDays)
    || !validNullableSafeInteger(row.processingTimeMaxDays)
    || !validNullableSafeInteger(row.shipsWithinDays)
    || (row.category !== null && (typeof row.category !== "string" || !CATEGORIES.has(row.category)))
    || !Array.isArray(row.tags)
    || !row.tags.every((tag) => typeof tag === "string")
    || !validNullableSafeInteger(row.packagedWeightGrams)
    || !validNullableFinite(row.packagedLengthCm)
    || !validNullableFinite(row.packagedWidthCm)
    || !validNullableFinite(row.packagedHeightCm)
    || !validNullableId(row.reservedForUserId)
    || !validNullableId(row.customOrderConversationId)
    || !nullableText(row.metaDescription)
    || !Array.isArray(row.materials)
    || !row.materials.every((material) => typeof material === "string")
    || !validNullableFinite(row.productLengthIn)
    || !validNullableFinite(row.productWidthIn)
    || !validNullableFinite(row.productHeightIn)
    || !validDate(row.createdAt)
    || !validDate(row.updatedAt)
    || photos === null
    || variantGroups === null
  ) {
    throw new Error("Listing owner export authority returned an invalid row");
  }
  return Object.freeze({
    id: row.id,
    title: row.title,
    description: row.description,
    priceCents: row.priceCents,
    priceVersion: row.priceVersion,
    currency: row.currency,
    status: row.status as ListingStatus,
    videoUrl: row.videoUrl,
    isPrivate: row.isPrivate,
    listingType: row.listingType as ListingType,
    stockQuantity: row.stockQuantity,
    processingTimeMinDays: row.processingTimeMinDays,
    processingTimeMaxDays: row.processingTimeMaxDays,
    shipsWithinDays: row.shipsWithinDays,
    category: row.category as Category | null,
    tags: Object.freeze([...row.tags]),
    packagedWeightGrams: row.packagedWeightGrams,
    packagedLengthCm: row.packagedLengthCm,
    packagedWidthCm: row.packagedWidthCm,
    packagedHeightCm: row.packagedHeightCm,
    reservedForUserId: row.reservedForUserId as string | null,
    customOrderConversationId: row.customOrderConversationId as string | null,
    metaDescription: row.metaDescription,
    materials: Object.freeze([...row.materials]),
    productLengthIn: row.productLengthIn,
    productWidthIn: row.productWidthIn,
    productHeightIn: row.productHeightIn,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    photos,
    variantGroups,
  });
}

const LISTING_OWNER_EXPORT_PAGE_LIMIT = 100;

export function listingOwnerExportRows(userId: string) {
  return withDbUserContext(userId, async (client) => {
    const result: ListingOwnerExportState[] = [];
    const ids = new Set<string>();
    let beforeCreatedAt: Date | null = null;
    let beforeListingId: string | null = null;

    for (;;) {
      const rows = await client.$queryRaw<ListingOwnerExportRow[]>`
        SELECT *
          FROM public.grainline_listing_owner_export_page(
            ${beforeCreatedAt}::timestamp,
            ${beforeListingId}::text,
            ${LISTING_OWNER_EXPORT_PAGE_LIMIT}::integer
          )
      `;
      if (rows.length > LISTING_OWNER_EXPORT_PAGE_LIMIT) {
        throw new Error("Listing owner export authority exceeded its page limit");
      }

      let previous = result.at(-1) ?? null;
      for (const row of rows) {
        const value = parseListingOwnerExportRow(row);
        if (ids.has(value.id)) {
          throw new Error("Listing owner export authority repeated a listing id");
        }
        if (
          previous
          && !(
            value.createdAt < previous.createdAt
            || (
              value.createdAt.getTime() === previous.createdAt.getTime()
              && value.id < previous.id
            )
          )
        ) {
          throw new Error("Listing owner export authority returned an invalid order");
        }
        ids.add(value.id);
        result.push(value);
        previous = value;
      }

      if (rows.length < LISTING_OWNER_EXPORT_PAGE_LIMIT) return result;
      const last = result.at(-1);
      if (
        !last
        || (
          beforeCreatedAt?.getTime() === last.createdAt.getTime()
          && beforeListingId === last.id
        )
      ) {
        throw new Error("Listing owner export cursor did not advance");
      }
      beforeCreatedAt = last.createdAt;
      beforeListingId = last.id;
    }
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    maxWait: 10_000,
    timeout: 30_000,
  });
}

function parseListingOwnerSummaryRow(
  row: ListingOwnerSummaryRow,
): ListingOwnerSummaryState {
  const photos = Array.isArray(row.photos)
    ? row.photos.map((candidate) => {
      const photo = recordValue(candidate);
      if (!photo || !isTextWithinCodePointRange(photo.url, 1, 2048)) return null;
      return Object.freeze({ url: photo.url });
    })
    : null;
  if (
    !validId(row.id)
    || !isTextWithinCodePointRange(row.title, 1, 150)
    || !validSafeInteger(row.priceCents)
    || row.priceCents < 1
    || typeof row.currency !== "string"
    || row.currency.length !== 3
    || typeof row.status !== "string"
    || !LISTING_STATUSES.has(row.status)
    || typeof row.isPrivate !== "boolean"
    || typeof row.listingType !== "string"
    || !LISTING_TYPES.has(row.listingType)
    || !validNullableSafeInteger(row.stockQuantity)
    || (row.stockQuantity !== null && row.stockQuantity < 0)
    || !validSafeInteger(row.viewCount)
    || row.viewCount < 0
    || !validSafeInteger(row.clickCount)
    || row.clickCount < 0
    || !validSafeInteger(row.favoriteCount)
    || row.favoriteCount < 0
    || !Array.isArray(row.aiReviewFlags)
    || !row.aiReviewFlags.every((flag) => typeof flag === "string")
    || typeof row.reviewedByAdmin !== "boolean"
    || !validDate(row.createdAt)
    || !validDate(row.updatedAt)
    || !(row.archivedAt === null || validDate(row.archivedAt))
    || photos === null
    || photos.length > 1
    || photos.some((photo) => photo === null)
  ) {
    throw new Error("Listing owner-summary authority returned an invalid row");
  }
  return Object.freeze({
    id: row.id,
    title: row.title,
    priceCents: row.priceCents,
    currency: row.currency,
    status: row.status as ListingStatus,
    isPrivate: row.isPrivate,
    listingType: row.listingType as ListingType,
    stockQuantity: row.stockQuantity,
    viewCount: row.viewCount,
    clickCount: row.clickCount,
    favoriteCount: row.favoriteCount,
    aiReviewFlags: Object.freeze([...row.aiReviewFlags]),
    reviewedByAdmin: row.reviewedByAdmin,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt as Date | null,
    photos: Object.freeze(photos as Array<NonNullable<(typeof photos)[number]>>),
  });
}

const LISTING_OWNER_SUMMARY_PAGE_LIMIT = 100;

export function listingOwnerSummaryRows(
  userId: string,
  options: ListingOwnerSummaryOptions = {},
) {
  const status = options.status ?? null;
  const listingType = options.listingType ?? null;
  const includeArchived = options.includeArchived ?? false;
  const skip = options.skip ?? 0;
  const take = options.take ?? null;
  if (
    (status !== null && !LISTING_STATUSES.has(status))
    || (listingType !== null && !LISTING_TYPES.has(listingType))
    || typeof includeArchived !== "boolean"
    || !Number.isSafeInteger(skip)
    || skip < 0
    || skip > 100_000
    || (take !== null && (!Number.isSafeInteger(take) || take < 1 || take > 1_000))
  ) {
    throw new RangeError("Listing owner-summary options are invalid");
  }

  return withDbUserContext(userId, async (client) => {
    const result: ListingOwnerSummaryState[] = [];
    const ids = new Set<string>();
    let beforeUpdatedAt: Date | null = null;
    let beforeListingId: string | null = null;
    let pageOffset = skip;

    for (;;) {
      const remaining = take === null ? LISTING_OWNER_SUMMARY_PAGE_LIMIT : take - result.length;
      if (remaining <= 0) return result;
      const pageLimit = Math.min(LISTING_OWNER_SUMMARY_PAGE_LIMIT, remaining);
      const rows = await client.$queryRaw<ListingOwnerSummaryRow[]>`
        SELECT *
          FROM public.grainline_listing_owner_summary_page(
            ${status}::text,
            ${listingType}::text,
            ${includeArchived}::boolean,
            ${pageOffset}::integer,
            ${beforeUpdatedAt}::timestamp,
            ${beforeListingId}::text,
            ${pageLimit}::integer
          )
      `;
      if (rows.length > pageLimit) {
        throw new Error("Listing owner-summary authority exceeded its page limit");
      }

      let previous = result.at(-1) ?? null;
      for (const row of rows) {
        const value = parseListingOwnerSummaryRow(row);
        if (ids.has(value.id)) {
          throw new Error("Listing owner-summary authority repeated a listing id");
        }
        if (
          previous
          && !(
            value.updatedAt < previous.updatedAt
            || (
              value.updatedAt.getTime() === previous.updatedAt.getTime()
              && value.id < previous.id
            )
          )
        ) {
          throw new Error("Listing owner-summary authority returned an invalid order");
        }
        ids.add(value.id);
        result.push(value);
        previous = value;
      }

      if (rows.length < pageLimit || (take !== null && result.length >= take)) {
        return result;
      }
      const last = result.at(-1);
      if (
        !last
        || (
          beforeUpdatedAt?.getTime() === last.updatedAt.getTime()
          && beforeListingId === last.id
        )
      ) {
        throw new Error("Listing owner-summary cursor did not advance");
      }
      beforeUpdatedAt = last.updatedAt;
      beforeListingId = last.id;
      pageOffset = 0;
    }
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    maxWait: 10_000,
    timeout: 30_000,
  });
}

export function listingOwnerWorkshopSummary(userId: string) {
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<ListingOwnerWorkshopSummaryRow[]>`
      SELECT * FROM public.grainline_listing_owner_workshop_summary()
    `;
    if (rows.length !== 1) {
      throw new Error("Listing workshop-summary authority returned invalid cardinality");
    }
    const row = rows[0];
    const statusCounts = recordValue(row.statusCounts);
    const lowStock = Array.isArray(row.lowStock)
      ? row.lowStock.map((candidate) => {
        const item = recordValue(candidate);
        if (
          !item
          || !isTextWithinCodePointRange(item.title, 1, 150)
          || !validSafeInteger(item.stockQuantity)
          || item.stockQuantity < 1
        ) return null;
        return Object.freeze({
          title: item.title,
          stockQuantity: item.stockQuantity,
        });
      })
      : null;
    if (
      !validCount(row.listingCount)
      || !validCount(row.inStockCount)
      || !statusCounts
      || Object.entries(statusCounts).some(([status, count]) => (
        !LISTING_STATUSES.has(status)
        || !validSafeInteger(count)
        || count < 0
      ))
      || !(row.underReviewTitle === null
        || isTextWithinCodePointRange(row.underReviewTitle, 1, 150))
      || lowStock === null
      || lowStock.length > 3
      || lowStock.some((item) => item === null)
    ) {
      throw new Error("Listing workshop-summary authority returned invalid data");
    }
    return Object.freeze({
      listingCount: Number(row.listingCount),
      statusCounts: Object.freeze(statusCounts as Record<string, number>),
      inStock: Number(row.inStockCount),
      underReviewTitle: row.underReviewTitle as string | null,
      lowStock: Object.freeze(
        lowStock as Array<NonNullable<(typeof lowStock)[number]>>,
      ),
    });
  });
}

export function listingOwnerCounts(userId: string) {
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<ListingOwnerCountsRow[]>`
      SELECT * FROM public.grainline_listing_owner_counts()
    `;
    if (rows.length !== 1) {
      throw new Error("Listing owner-count authority returned invalid cardinality");
    }
    const row = rows[0];
    if (
      !validCount(row.draftCount)
      || !validCount(row.activeCount)
      || !validCount(row.activePublicCount)
      || row.activePublicCount > row.activeCount
      || !(row.oldestListingId === null || validId(row.oldestListingId))
    ) {
      throw new Error("Listing owner-count authority returned invalid counts");
    }
    return Object.freeze({
      draftCount: Number(row.draftCount),
      activeCount: Number(row.activeCount),
      activePublicCount: Number(row.activePublicCount),
      oldestListingId: row.oldestListingId as string | null,
    });
  });
}

export function listingOwnerRatingBuckets(
  userId: string,
  input: {
    startDate: Date;
    endDate: Date;
    endExclusive: boolean;
  },
) {
  const startEpochMillis = input.startDate.getTime();
  const endEpochMillis = input.endDate.getTime();
  if (
    !Number.isSafeInteger(startEpochMillis)
    || !Number.isSafeInteger(endEpochMillis)
    || startEpochMillis < 0
    || endEpochMillis < startEpochMillis
    || typeof input.endExclusive !== "boolean"
  ) {
    throw new RangeError("Listing owner rating range is invalid");
  }

  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<ListingOwnerRatingBucketRow[]>`
      SELECT *
        FROM public.grainline_listing_owner_rating_buckets(
          ${BigInt(startEpochMillis)}::bigint,
          ${BigInt(endEpochMillis)}::bigint,
          ${input.endExclusive}::boolean
        )
    `;
    let previousBucket = -1;
    return Object.freeze(rows.map((row) => {
      const bucketEpochMillis = typeof row.bucketEpochMillis === "bigint"
        && row.bucketEpochMillis >= 0n
        && row.bucketEpochMillis <= 253402300799999n
        ? Number(row.bucketEpochMillis)
        : null;
      const reviewCount = typeof row.reviewCount === "bigint"
        && row.reviewCount > 0n
        && row.reviewCount <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(row.reviewCount)
        : null;
      if (
        bucketEpochMillis === null
        || bucketEpochMillis <= previousBucket
        || typeof row.averageRating !== "number"
        || !Number.isFinite(row.averageRating)
        || row.averageRating < 0.5
        || row.averageRating > 5
        || reviewCount === null
      ) {
        throw new Error("Listing owner rating authority returned an invalid row");
      }
      previousBucket = bucketEpochMillis;
      return Object.freeze({
        date: new Date(bucketEpochMillis),
        averageRating: row.averageRating,
        reviewCount,
      }) satisfies ListingOwnerRatingBucket;
    }));
  });
}
