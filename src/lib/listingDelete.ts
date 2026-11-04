import { Prisma } from "@prisma/client";
import {
  DirectUploadClaimError,
  syncListingDirectUploadReferences,
} from "@/lib/directUploadLifecycle";
import { deleteListingBlockReason } from "@/lib/listingActionState";
import {
  listingDeleteDisposition,
  type ListingRetainedReferenceState,
} from "@/lib/listingDeleteState";
import { getListingOrderArchiveBlocked } from "@/lib/orderEligibilityAuthority";
import { CASE_WINDOW_DAYS } from "@/lib/caseCreateState";
import { normalizeDbUserContextUserId } from "@/lib/dbUserContextState";
import { withSerializableDbUserContext } from "@/lib/dbUserContext";
import { sellerOwnerCore } from "@/lib/sellerProfileOwnerAccess";
import { deleteCartItemsForSellerListing } from "@/lib/cartServiceAccess";
import { deleteStockNotificationsForSellerListing } from "@/lib/stockNotificationAccess";
import { deleteFavoritesForSellerListing } from "@/lib/favoriteAccess";
import {
  archiveListingOwnerDeleteState,
  hardDeleteListingOwnerDeleteState,
  lockListingOwnerDeleteState,
} from "@/lib/listingOwnerAccess";

export const LISTING_DELETE_TERMINAL_ORDER_BLOCK_DAYS = CASE_WINDOW_DAYS;

export type ListingDeleteOutcome = "deleted" | "archived";

export class ListingDeleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ListingDeleteError";
  }
}

export function listingDeletePublicError(error: unknown) {
  return error instanceof ListingDeleteError ? error.message : null;
}

export async function deleteListingWithCleanup(
  listingId: string,
  actorUserId: string,
): Promise<ListingDeleteOutcome> {
  const normalizedActorUserId = normalizeDbUserContextUserId(actorUserId);
  const normalizedListingId = listingId.trim();
  if (normalizedListingId.length < 1 || normalizedListingId.length > 191) {
    throw new ListingDeleteError("Listing not found.");
  }
  if (!(await sellerOwnerCore(normalizedActorUserId))) {
    throw new ListingDeleteError("Listing not found.");
  }
  return withSerializableDbUserContext(
    normalizedActorUserId,
    async (tx) => {
      // The row lock keeps the reference decision and delete/archive mutation
      // atomic. New foreign-key references need a conflicting key-share lock,
      // so they cannot appear between this check and the final mutation.
      const listing = await lockListingOwnerDeleteState(
        tx,
        normalizedListingId,
      );
      if (!listing) {
        throw new ListingDeleteError("Listing not found.");
      }

      const stateBlockReason = deleteListingBlockReason(listing);
      if (stateBlockReason) {
        throw new ListingDeleteError(stateBlockReason);
      }

      const referenceRows = await tx.$queryRaw<ListingRetainedReferenceState[]>(Prisma.sql`
        SELECT *
          FROM public.grainline_listing_delete_reference_state(
            ${normalizedActorUserId},
            ${normalizedListingId}
          )
      `);
      const references = referenceRows[0];
      if (!references) {
        throw new Error("Listing reference state could not be inspected.");
      }

      const disposition = listingDeleteDisposition(
        listing.customOrderConversationId,
        references,
      );

      // A retained checkout reservation is still a live buyer interaction,
      // not historical data. Hiding the listing underneath that checkout
      // would make a later paid webhook reject/refund the purchase, so wait
      // for the reservation to complete or expire instead of archiving it.
      if (disposition === "blocked_checkout") {
        throw new ListingDeleteError(
          "Cannot delete this listing while a buyer checkout is in progress. Try again after the checkout expires.",
        );
      }

      if (disposition === "archive") {
        const orderBlocked = await getListingOrderArchiveBlocked(
          { actorUserId: normalizedActorUserId, listingId: normalizedListingId, now: new Date() },
          tx,
        );
        if (orderBlocked == null) {
          throw new ListingDeleteError("Listing not found.");
        }
        if (orderBlocked) {
          throw new ListingDeleteError(
            "Cannot delete a listing with open, active, or recently fulfilled orders inside the case window.",
          );
        }

        const archived = await archiveListingOwnerDeleteState(
          tx,
          normalizedListingId,
          listing.updatedAt,
        );
        if (!archived.applied) {
          throw new ListingDeleteError("Listing state changed; refresh and try again.");
        }

        await deleteFavoritesForSellerListing(tx, normalizedListingId);
        await deleteStockNotificationsForSellerListing(tx, normalizedListingId);
        await deleteCartItemsForSellerListing(tx, normalizedListingId);
        return "archived";
      }

      try {
        // The existing Listing delete trigger releases these verified
        // references and schedules the underlying R2 objects for cleanup.
        await syncListingDirectUploadReferences({
          client: tx,
          userId: normalizedActorUserId,
          listingId: normalizedListingId,
          requireAllTracked: true,
        });
      } catch (error) {
        if (error instanceof DirectUploadClaimError) {
          throw new ListingDeleteError(
            "This listing's media could not be safely queued for deletion. Re-upload the media or contact support.",
          );
        }
        throw error;
      }

      const deleted = await hardDeleteListingOwnerDeleteState(
        tx,
        normalizedListingId,
        listing.updatedAt,
      );
      if (!deleted.applied) {
        throw new ListingDeleteError("Listing state changed; refresh and try again.");
      }
      return "deleted";
    },
  );
}
