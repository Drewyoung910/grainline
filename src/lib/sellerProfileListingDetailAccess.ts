import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  withDbUserContext,
  type DbUserContextTransactionClient,
} from "@/lib/dbUserContext";
import { isTextWithinCodePointRange } from "@/lib/textLength";

type ListingDetailAccessClient = Pick<DbUserContextTransactionClient, "$queryRaw">;
type StaffListingDetailAccessClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export type SellerListingDetailProfile = Readonly<{
  id: string;
  userId: string;
  displayName: string;
  city: string | null;
  state: string | null;
  allowLocalPickup: boolean;
  chargesEnabled: boolean;
  stripeAccountSupported: boolean;
  vacationMode: boolean;
  acceptingNewOrders: boolean;
  acceptsCustomOrders: boolean;
  offersGiftWrapping: boolean;
  giftWrappingPriceCents: number | null;
  returnPolicy: string | null;
  shippingPolicy: string | null;
  customOrderPolicy: string | null;
  tagline: string | null;
  avatarImageUrl: string | null;
  guildLevel: "NONE" | "GUILD_MEMBER" | "GUILD_MASTER";
  isFoundingMaker: boolean;
  foundingMakerNumber: number | null;
  ownerAccountActive: boolean;
  ownerImageUrl: string | null;
}>;

type SellerListingDetailProfileRow = Readonly<{
  listingId: unknown;
  sellerProfileId: unknown;
  sellerUserId: unknown;
  displayName: unknown;
  city: unknown;
  state: unknown;
  allowLocalPickup: unknown;
  chargesEnabled: unknown;
  stripeAccountSupported: unknown;
  vacationMode: unknown;
  acceptingNewOrders: unknown;
  acceptsCustomOrders: unknown;
  offersGiftWrapping: unknown;
  giftWrappingPriceCents: unknown;
  returnPolicy: unknown;
  shippingPolicy: unknown;
  customOrderPolicy: unknown;
  tagline: unknown;
  avatarImageUrl: unknown;
  guildLevel: unknown;
  isFoundingMaker: unknown;
  foundingMakerNumber: unknown;
  ownerAccountActive: unknown;
  ownerImageUrl: unknown;
}>;

const GUILD_LEVELS = new Set(["NONE", "GUILD_MEMBER", "GUILD_MASTER"]);

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/u.test(value);
}

function nullableBoundedString(value: unknown, max: number): value is string | null {
  return value === null || isTextWithinCodePointRange(value, 0, max);
}

function parseProfile(
  rows: readonly SellerListingDetailProfileRow[],
  listingId: string,
): SellerListingDetailProfile | null {
  if (rows.length === 0) return null;
  if (rows.length !== 1) {
    throw new Error("Seller listing-detail authority returned multiple rows");
  }
  const row = rows[0];
  if (
    row.listingId !== listingId
    || !validId(row.sellerProfileId)
    || !validId(row.sellerUserId)
    || !isTextWithinCodePointRange(row.displayName, 1, 100)
    || !nullableBoundedString(row.city, 100)
    || !nullableBoundedString(row.state, 50)
    || typeof row.allowLocalPickup !== "boolean"
    || typeof row.chargesEnabled !== "boolean"
    || typeof row.stripeAccountSupported !== "boolean"
    || typeof row.vacationMode !== "boolean"
    || typeof row.acceptingNewOrders !== "boolean"
    || typeof row.acceptsCustomOrders !== "boolean"
    || typeof row.offersGiftWrapping !== "boolean"
    || !(
      row.giftWrappingPriceCents === null
      || (Number.isSafeInteger(row.giftWrappingPriceCents) && Number(row.giftWrappingPriceCents) >= 0)
    )
    || !nullableBoundedString(row.returnPolicy, 2000)
    || !nullableBoundedString(row.shippingPolicy, 2000)
    || !nullableBoundedString(row.customOrderPolicy, 2000)
    || !nullableBoundedString(row.tagline, 140)
    || !nullableBoundedString(row.avatarImageUrl, 2048)
    || typeof row.guildLevel !== "string"
    || !GUILD_LEVELS.has(row.guildLevel)
    || typeof row.isFoundingMaker !== "boolean"
    || !(
      row.foundingMakerNumber === null
      || (Number.isSafeInteger(row.foundingMakerNumber)
        && Number(row.foundingMakerNumber) >= 1
        && Number(row.foundingMakerNumber) <= 250)
    )
    || typeof row.ownerAccountActive !== "boolean"
    || !nullableBoundedString(row.ownerImageUrl, 2048)
  ) {
    throw new Error("Seller listing-detail authority returned an invalid row");
  }
  return Object.freeze({
    id: row.sellerProfileId,
    userId: row.sellerUserId,
    displayName: row.displayName,
    city: row.city,
    state: row.state,
    allowLocalPickup: row.allowLocalPickup,
    chargesEnabled: row.chargesEnabled,
    stripeAccountSupported: row.stripeAccountSupported,
    vacationMode: row.vacationMode,
    acceptingNewOrders: row.acceptingNewOrders,
    acceptsCustomOrders: row.acceptsCustomOrders,
    offersGiftWrapping: row.offersGiftWrapping,
    giftWrappingPriceCents: row.giftWrappingPriceCents as number | null,
    returnPolicy: row.returnPolicy,
    shippingPolicy: row.shippingPolicy,
    customOrderPolicy: row.customOrderPolicy,
    tagline: row.tagline,
    avatarImageUrl: row.avatarImageUrl,
    guildLevel: row.guildLevel as SellerListingDetailProfile["guildLevel"],
    isFoundingMaker: row.isFoundingMaker,
    foundingMakerNumber: row.foundingMakerNumber as number | null,
    ownerAccountActive: row.ownerAccountActive,
    ownerImageUrl: row.ownerImageUrl,
  });
}

async function readActorProfile(
  client: ListingDetailAccessClient,
  listingId: string,
) {
  const rows = await client.$queryRaw<SellerListingDetailProfileRow[]>`
    SELECT *
      FROM public.grainline_seller_actor_listing_detail_profile(${listingId})
  `;
  return parseProfile(rows, listingId);
}

export async function sellerListingDetailProfile(
  viewerUserId: string | null,
  listingId: string,
) {
  if (!validId(listingId)) {
    throw new RangeError("Seller listing-detail id is outside the supported range");
  }
  if (viewerUserId) {
    if (!validId(viewerUserId)) {
      throw new RangeError("Seller listing-detail viewer is outside the supported range");
    }
    return withDbUserContext(viewerUserId, (client) => readActorProfile(client, listingId));
  }
  return readActorProfile(prisma, listingId);
}

export async function sellerStaffListingDetailProfile(
  client: StaffListingDetailAccessClient,
  actorUserId: string,
  listingId: string,
) {
  if (!validId(actorUserId) || !validId(listingId)) {
    throw new RangeError("Seller listing-detail staff input is outside the supported range");
  }
  const rows = await client.$queryRaw<SellerListingDetailProfileRow[]>`
    SELECT *
      FROM public.grainline_seller_staff_listing_detail_profile(
        ${actorUserId},
        ${listingId}
      )
  `;
  return parseProfile(rows, listingId);
}
