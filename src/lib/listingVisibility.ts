import { ListingStatus, Prisma } from "@prisma/client";

export function publicListingWhere(extra: Prisma.ListingWhereInput = {}): Prisma.ListingWhereInput {
  return {
    status: ListingStatus.ACTIVE,
    isPrivate: false,
    seller: {
      chargesEnabled: true,
      vacationMode: false,
      user: { banned: false },
    },
    ...extra,
  };
}

type ListingVisibilityInput = {
  status: ListingStatus | string;
  isPrivate: boolean;
  reservedForUserId?: string | null;
  seller: {
    chargesEnabled: boolean;
    vacationMode?: boolean | null;
    user?: {
      id?: string | null;
      clerkId?: string | null;
      banned?: boolean | null;
    } | null;
  };
};

export function isPublicListing(listing: ListingVisibilityInput) {
  return (
    listing.status === ListingStatus.ACTIVE &&
    !listing.isPrivate &&
    listing.seller.chargesEnabled &&
    !listing.seller.vacationMode &&
    !listing.seller.user?.banned
  );
}

export function canViewListingDetail(
  listing: ListingVisibilityInput,
  viewer: { dbUserId?: string | null; clerkUserId?: string | null; preview?: boolean },
) {
  const isOwner = !!viewer.clerkUserId && listing.seller.user?.clerkId === viewer.clerkUserId;
  if (viewer.preview && isOwner) return true;
  if (isOwner) return true;

  const reservedForViewer =
    listing.status === ListingStatus.ACTIVE &&
    listing.isPrivate &&
    !!viewer.dbUserId &&
    listing.reservedForUserId === viewer.dbUserId;

  if (reservedForViewer) {
    return listing.seller.chargesEnabled && !listing.seller.vacationMode && !listing.seller.user?.banned;
  }

  return isPublicListing(listing);
}
