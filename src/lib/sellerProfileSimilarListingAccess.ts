import type { Prisma } from "@prisma/client";
import { isTextWithinCodePointRange } from "@/lib/textLength";

import { prisma } from "@/lib/db";
import { withDbUserContext } from "@/lib/dbUserContext";
import {
  isSimilarListingCategoryMatch,
  normalizeSimilarListingCategoryMatch,
} from "./sellerSimilarListingCategory.ts";

export type SellerSimilarListingCandidate = Readonly<{
  sourceTitle: string;
  sourcePriceCents: number;
  id: string;
  title: string;
  priceCents: number;
  currency: string;
  status: "ACTIVE";
  listingType: "IN_STOCK" | "MADE_TO_ORDER";
  stockQuantity: number | null;
  photoUrl: string | null;
  photoAltText: string | null;
  secondPhotoUrl: string | null;
  secondPhotoAltText: string | null;
  sellerDisplayName: string;
  sellerAvatarImageUrl: string | null;
  sellerGuildLevel: "NONE" | "GUILD_MEMBER" | "GUILD_MASTER";
  sellerId: string;
  sellerCity: string | null;
  sellerState: string | null;
  sellerAcceptingNewOrders: boolean;
  createdAt: Date;
  tagOverlap: bigint;
  categoryMatch: boolean;
}>;

type SimilarListingCandidateRow = Readonly<{
  sourceTitle: unknown;
  sourcePriceCents: unknown;
  listingId: unknown;
  title: unknown;
  priceCents: unknown;
  currency: unknown;
  status: unknown;
  listingType: unknown;
  stockQuantity: unknown;
  photoUrl: unknown;
  photoAltText: unknown;
  secondPhotoUrl: unknown;
  secondPhotoAltText: unknown;
  sellerDisplayName: unknown;
  sellerAvatarImageUrl: unknown;
  sellerGuildLevel: unknown;
  sellerProfileId: unknown;
  sellerCity: unknown;
  sellerState: unknown;
  sellerAcceptingNewOrders: unknown;
  createdAt: unknown;
  tagOverlap: unknown;
  categoryMatch: unknown;
}>;

type SimilarListingClient = Pick<Prisma.TransactionClient, "$queryRaw">;

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/u.test(value);
}

function boundedString(value: unknown, max: number): value is string {
  return isTextWithinCodePointRange(value, 1, max);
}

function nullableBoundedString(value: unknown, max: number): value is string | null {
  return value === null || isTextWithinCodePointRange(value, 0, max);
}

function safeMoney(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

async function readCandidates(client: SimilarListingClient, listingId: string) {
  const rows = await client.$queryRaw<SimilarListingCandidateRow[]>`
    SELECT *
      FROM public.grainline_seller_actor_similar_listing_candidates(${listingId})
  `;
  if (
    rows.length > 24
    || new Set(rows.map((row) => row.listingId)).size !== rows.length
    || rows.some((row) => (
      !boundedString(row.sourceTitle, 200)
      || !safeMoney(row.sourcePriceCents)
      || !validId(row.listingId)
      || row.listingId === listingId
      || !boundedString(row.title, 200)
      || !safeMoney(row.priceCents)
      || typeof row.currency !== "string"
      || !/^[a-z]{3}$/u.test(row.currency)
      || row.status !== "ACTIVE"
      || !["IN_STOCK", "MADE_TO_ORDER"].includes(String(row.listingType))
      || !(row.stockQuantity === null || (Number.isSafeInteger(row.stockQuantity) && Number(row.stockQuantity) >= 0))
      || !nullableBoundedString(row.photoUrl, 2048)
      || !nullableBoundedString(row.photoAltText, 500)
      || !nullableBoundedString(row.secondPhotoUrl, 2048)
      || !nullableBoundedString(row.secondPhotoAltText, 500)
      || !boundedString(row.sellerDisplayName, 100)
      || !nullableBoundedString(row.sellerAvatarImageUrl, 2048)
      || !["NONE", "GUILD_MEMBER", "GUILD_MASTER"].includes(String(row.sellerGuildLevel))
      || !validId(row.sellerProfileId)
      || !nullableBoundedString(row.sellerCity, 100)
      || !nullableBoundedString(row.sellerState, 50)
      || typeof row.sellerAcceptingNewOrders !== "boolean"
      || !(row.createdAt instanceof Date) || Number.isNaN(row.createdAt.getTime())
      || typeof row.tagOverlap !== "bigint" || row.tagOverlap < 0n
      || !isSimilarListingCategoryMatch(row.categoryMatch)
    ))
  ) {
    throw new Error("Seller similar-listing authority returned an invalid result");
  }
  return Object.freeze(rows.map((row) => Object.freeze({
    sourceTitle: row.sourceTitle as string,
    sourcePriceCents: row.sourcePriceCents as number,
    id: row.listingId as string,
    title: row.title as string,
    priceCents: row.priceCents as number,
    currency: row.currency as string,
    status: "ACTIVE" as const,
    listingType: row.listingType as SellerSimilarListingCandidate["listingType"],
    stockQuantity: row.stockQuantity as number | null,
    photoUrl: row.photoUrl as string | null,
    photoAltText: row.photoAltText as string | null,
    secondPhotoUrl: row.secondPhotoUrl as string | null,
    secondPhotoAltText: row.secondPhotoAltText as string | null,
    sellerDisplayName: row.sellerDisplayName as string,
    sellerAvatarImageUrl: row.sellerAvatarImageUrl as string | null,
    sellerGuildLevel: row.sellerGuildLevel as SellerSimilarListingCandidate["sellerGuildLevel"],
    sellerId: row.sellerProfileId as string,
    sellerCity: row.sellerCity as string | null,
    sellerState: row.sellerState as string | null,
    sellerAcceptingNewOrders: row.sellerAcceptingNewOrders as boolean,
    createdAt: row.createdAt as Date,
    tagOverlap: row.tagOverlap as bigint,
    categoryMatch: normalizeSimilarListingCategoryMatch(
      row.categoryMatch as boolean | null,
    ),
  })));
}

export async function sellerActorSimilarListingCandidates(
  viewerUserId: string | null,
  listingId: string,
) {
  if (!validId(listingId) || (viewerUserId !== null && !validId(viewerUserId))) {
    throw new RangeError("Seller similar-listing input is outside the supported range");
  }
  if (viewerUserId) {
    return withDbUserContext(viewerUserId, (client) => readCandidates(client, listingId));
  }
  return readCandidates(prisma, listingId);
}
