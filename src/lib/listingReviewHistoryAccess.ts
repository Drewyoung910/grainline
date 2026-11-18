import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  withDbUserContext,
  type DbUserContextTransactionClient,
} from "@/lib/dbUserContext";
import { isTextWithinCodePointRange } from "@/lib/textLength";

type ReviewHistoryClient = Pick<DbUserContextTransactionClient, "$queryRaw">;

type ActorReviewContextRow = Readonly<{
  reviewId: unknown;
  listingId: unknown;
  listingTitle: unknown;
  sellerProfileId: unknown;
  listingPhotoUrl: unknown;
}>;

type CustomerPhotoPageRow = Readonly<{
  totalCount: unknown;
  photos: unknown;
}>;

export type ListingActorReviewContext = Readonly<{
  reviewId: string;
  listingId: string;
  listingTitle: string;
  sellerProfileId: string;
  listingPhotoUrl: string | null;
}>;

export type ListingPublicCustomerPhoto = Readonly<{
  id: string;
  url: string;
  altText: string | null;
  listingId: string;
  listingTitle: string;
  reviewerId: string;
}>;

export type ListingPublicCustomerPhotoPage = Readonly<{
  total: number;
  photos: ReadonlyArray<ListingPublicCustomerPhoto>;
}>;

const ID = /^[A-Za-z0-9._:-]{1,191}$/u;
const REVIEW_CONTEXT_CHUNK_SIZE = 200;
const MAX_REVIEW_CONTEXTS = 10_000;

function validId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

function nullableBoundedText(
  value: unknown,
  min: number,
  max: number,
): value is string | null {
  return value === null || isTextWithinCodePointRange(value, min, max);
}

async function readActorReviewContexts(
  client: ReviewHistoryClient,
  reviewIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<ListingActorReviewContext>> {
  const requested = new Set(reviewIds);
  const returned = new Set<string>();
  const rows = await client.$queryRaw<ActorReviewContextRow[]>(Prisma.sql`
    SELECT *
      FROM public.grainline_listing_actor_review_contexts(
        ${reviewIds}::text[]
      )
  `);
  if (
    rows.length > reviewIds.length
    || rows.some((row) => {
      const valid = validId(row.reviewId)
        && requested.has(row.reviewId)
        && !returned.has(row.reviewId)
        && validId(row.listingId)
        && isTextWithinCodePointRange(row.listingTitle, 1, 150)
        && validId(row.sellerProfileId)
        && nullableBoundedText(row.listingPhotoUrl, 1, 2048);
      if (validId(row.reviewId)) returned.add(row.reviewId);
      return !valid;
    })
  ) {
    throw new Error("Listing actor review-context authority returned an invalid result");
  }
  return Object.freeze(rows.map((row) => Object.freeze({
    reviewId: row.reviewId as string,
    listingId: row.listingId as string,
    listingTitle: row.listingTitle as string,
    sellerProfileId: row.sellerProfileId as string,
    listingPhotoUrl: row.listingPhotoUrl as string | null,
  })));
}

export function listingActorReviewContexts(
  actorUserId: string,
  sourceReviewIds: ReadonlyArray<string>,
) {
  const reviewIds = [...new Set(sourceReviewIds)];
  if (
    !validId(actorUserId)
    || reviewIds.length > MAX_REVIEW_CONTEXTS
    || reviewIds.some((reviewId) => !validId(reviewId))
  ) {
    throw new RangeError("Listing actor review-context input is invalid");
  }
  if (reviewIds.length === 0) {
    return Promise.resolve(Object.freeze([]) as ReadonlyArray<ListingActorReviewContext>);
  }
  return withDbUserContext(actorUserId, async (client) => {
    const contexts: ListingActorReviewContext[] = [];
    for (let offset = 0; offset < reviewIds.length; offset += REVIEW_CONTEXT_CHUNK_SIZE) {
      contexts.push(...await readActorReviewContexts(
        client,
        reviewIds.slice(offset, offset + REVIEW_CONTEXT_CHUNK_SIZE),
      ));
    }
    return Object.freeze(contexts);
  });
}

function parseCustomerPhoto(value: unknown): ListingPublicCustomerPhoto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    !validId(row.id)
    || !isTextWithinCodePointRange(row.url, 1, 2048)
    || !nullableBoundedText(row.altText, 0, 200)
    || !validId(row.listingId)
    || !isTextWithinCodePointRange(row.listingTitle, 1, 150)
    || !validId(row.reviewerId)
  ) return null;
  return Object.freeze({
    id: row.id,
    url: row.url,
    altText: row.altText,
    listingId: row.listingId,
    listingTitle: row.listingTitle,
    reviewerId: row.reviewerId,
  });
}

async function readPublicCustomerPhotoPage(
  client: ReviewHistoryClient,
  sellerProfileId: string,
  offset: number,
  limit: number,
): Promise<ListingPublicCustomerPhotoPage> {
  const rows = await client.$queryRaw<CustomerPhotoPageRow[]>(Prisma.sql`
    SELECT *
      FROM public.grainline_listing_public_customer_photo_page(
        ${sellerProfileId}::text,
        ${offset}::integer,
        ${limit}::integer
      )
  `);
  const row = rows[0];
  const total = typeof row?.totalCount === "bigint"
    ? Number(row.totalCount)
    : Number.NaN;
  const photos = Array.isArray(row?.photos)
    ? row.photos.map(parseCustomerPhoto)
    : [];
  if (
    rows.length !== 1
    || !Number.isSafeInteger(total)
    || total < 0
    || !Array.isArray(row?.photos)
    || photos.length > limit
    || photos.some((photo) => photo === null)
  ) {
    throw new Error("Listing public customer-photo authority returned an invalid result");
  }
  return Object.freeze({
    total,
    photos: Object.freeze(photos as ListingPublicCustomerPhoto[]),
  });
}

export function listingPublicCustomerPhotoPage(
  viewerUserId: string | null,
  sellerProfileId: string,
  offset: number,
  limit: number,
) {
  if (
    !validId(sellerProfileId)
    || (viewerUserId !== null && !validId(viewerUserId))
    || !Number.isSafeInteger(offset)
    || offset < 0
    || offset > 12_000
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > 50
  ) {
    throw new RangeError("Listing public customer-photo input is invalid");
  }
  if (viewerUserId) {
    return withDbUserContext(viewerUserId, (client) =>
      readPublicCustomerPhotoPage(client, sellerProfileId, offset, limit));
  }
  return readPublicCustomerPhotoPage(prisma, sellerProfileId, offset, limit);
}
