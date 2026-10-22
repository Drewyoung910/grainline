import { ListingStatus, Prisma } from "@prisma/client";

export function publicListingWhere(extra: Prisma.ListingWhereInput = {}): Prisma.ListingWhereInput {
  return {
    AND: [
      {
        status: ListingStatus.ACTIVE,
        isPrivate: false,
        archivedAt: null,
        sellerPubliclyOrderable: true,
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
        archivedAt: null,
        sellerPubliclyOrderable: true,
      },
      extra,
    ],
  };
}

type ListingVisibilityInput = {
  status: ListingStatus | string;
  isPrivate: boolean;
  archivedAt?: Date | string | null;
  reservedForUserId?: string | null;
  seller: {
    userId?: string | null;
    ownerAccountActive: boolean;
    chargesEnabled: boolean;
    stripeAccountSupported: boolean;
    vacationMode?: boolean | null;
  };
};

export function isPublicListing(listing: ListingVisibilityInput) {
  return (
    !listing.archivedAt &&
    listing.status === ListingStatus.ACTIVE &&
    !listing.isPrivate &&
    listing.seller.chargesEnabled &&
    listing.seller.stripeAccountSupported &&
    !listing.seller.vacationMode &&
    listing.seller.ownerAccountActive
  );
}

export function isPublicListingDetail(listing: ListingVisibilityInput) {
  return (
    !listing.archivedAt &&
    (listing.status === ListingStatus.ACTIVE || listing.status === ListingStatus.SOLD_OUT) &&
    !listing.isPrivate &&
    listing.seller.chargesEnabled &&
    listing.seller.stripeAccountSupported &&
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
  // Delete is permanent from every listing-detail surface. The retained row
  // exists only to preserve order/review/conversation history.
  if (listing.archivedAt) return false;

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
      listing.seller.stripeAccountSupported &&
      !listing.seller.vacationMode &&
      listing.seller.ownerAccountActive
    );
  }

  return isPublicListingDetail(listing);
}
