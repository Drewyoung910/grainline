import { ListingStatus, Prisma } from "@prisma/client";

const SUPPORTED_STRIPE_CONNECT_ACCOUNT_VERSION = "v2";

const PUBLIC_SELLER_STATE = {
  chargesEnabled: true,
  OR: [
    { stripeAccountVersion: null },
    { stripeAccountVersion: SUPPORTED_STRIPE_CONNECT_ACCOUNT_VERSION },
  ],
  vacationMode: false,
  ownerAccountActive: true,
} satisfies Prisma.SellerProfileWhereInput;

function isSupportedPublicStripeAccountVersion(version: string | null | undefined) {
  return version == null || version === SUPPORTED_STRIPE_CONNECT_ACCOUNT_VERSION;
}

export function publicListingWhere(extra: Prisma.ListingWhereInput = {}): Prisma.ListingWhereInput {
  return {
    AND: [
      {
        status: ListingStatus.ACTIVE,
        isPrivate: false,
        seller: PUBLIC_SELLER_STATE,
      },
      extra,
    ],
  };
}

export function publicListingDetailWhere(extra: Prisma.ListingWhereInput = {}): Prisma.ListingWhereInput {
  return {
    AND: [
      {
        status: { in: [ListingStatus.ACTIVE, ListingStatus.SOLD_OUT] },
        isPrivate: false,
        seller: PUBLIC_SELLER_STATE,
      },
      extra,
    ],
  };
}

type ListingVisibilityInput = {
  status: ListingStatus | string;
  isPrivate: boolean;
  reservedForUserId?: string | null;
  seller: {
    userId?: string | null;
    ownerAccountActive: boolean;
    chargesEnabled: boolean;
    stripeAccountVersion?: string | null;
    vacationMode?: boolean | null;
  };
};

export function isPublicListing(listing: ListingVisibilityInput) {
  return (
    listing.status === ListingStatus.ACTIVE &&
    !listing.isPrivate &&
    listing.seller.chargesEnabled &&
    isSupportedPublicStripeAccountVersion(listing.seller.stripeAccountVersion) &&
    !listing.seller.vacationMode &&
    listing.seller.ownerAccountActive
  );
}

export function isPublicListingDetail(listing: ListingVisibilityInput) {
  return (
    (listing.status === ListingStatus.ACTIVE || listing.status === ListingStatus.SOLD_OUT) &&
    !listing.isPrivate &&
    listing.seller.chargesEnabled &&
    isSupportedPublicStripeAccountVersion(listing.seller.stripeAccountVersion) &&
    !listing.seller.vacationMode &&
    listing.seller.ownerAccountActive
  );
}

export function canViewListingDetail(
  listing: ListingVisibilityInput,
  viewer: {
    dbUserId?: string | null;
    preview?: boolean;
    staffPreview?: boolean;
    role?: string | null;
    banned?: boolean | null;
    deletedAt?: Date | string | null;
  },
) {
  const viewerAccountActive = !viewer.banned && !viewer.deletedAt;
  if (
    viewer.staffPreview &&
    viewerAccountActive &&
    (viewer.role === "ADMIN" || viewer.role === "EMPLOYEE")
  ) {
    return true;
  }

  if (!viewerAccountActive) return false;

  const isOwner = !!viewer.dbUserId && listing.seller.userId === viewer.dbUserId;
  if (viewer.preview && isOwner) return true;
  if (isOwner) return true;

  const reservedForViewer =
    (listing.status === ListingStatus.ACTIVE || listing.status === ListingStatus.SOLD) &&
    listing.isPrivate &&
    !!viewer.dbUserId &&
    listing.reservedForUserId === viewer.dbUserId;

  if (reservedForViewer) {
    return (
      listing.seller.chargesEnabled &&
      isSupportedPublicStripeAccountVersion(listing.seller.stripeAccountVersion) &&
      !listing.seller.vacationMode &&
      listing.seller.ownerAccountActive
    );
  }

  return isPublicListingDetail(listing);
}
