import { ListingStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
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
import { withSerializableRetry } from "@/lib/transactionRetry";
import { CASE_WINDOW_DAYS } from "@/lib/caseCreateState";
import { normalizeDbUserContextUserId } from "@/lib/dbUserContextState";
import { sellerOwnerCore } from "@/lib/sellerProfileOwnerAccess";

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

type LockedListingRow = {
  id: string;
  sellerId: string;
  status: ListingStatus;
  isPrivate: boolean;
  archivedAt: Date | null;
  customOrderConversationId: string | null;
};

export async function deleteListingWithCleanup(
  listingId: string,
  actorUserId: string,
): Promise<ListingDeleteOutcome> {
  const normalizedActorUserId = normalizeDbUserContextUserId(actorUserId);
  const normalizedListingId = listingId.trim();
  if (normalizedListingId.length < 1 || normalizedListingId.length > 191) {
    throw new ListingDeleteError("Listing not found.");
  }
  const owner = await sellerOwnerCore(normalizedActorUserId);
  if (!owner) {
    throw new ListingDeleteError("Listing not found.");
  }
  return withSerializableRetry(() =>
    prisma.$transaction(async (tx) => {
      // The row lock keeps the reference decision and delete/archive mutation
      // atomic. New foreign-key references need a conflicting key-share lock,
      // so they cannot appear between this check and the final mutation.
      const rows = await tx.$queryRaw<LockedListingRow[]>(Prisma.sql`
        SELECT
          listing.id,
          listing."sellerId",
          listing.status,
          listing."isPrivate",
          listing."archivedAt",
          listing."customOrderConversationId"
        FROM public."Listing" AS listing
        WHERE listing.id = ${normalizedListingId}
          AND listing."sellerId" = ${owner.sellerProfileId}
        FOR UPDATE OF listing
      `);
      const listing = rows[0];
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

        const archived = await tx.listing.updateMany({
          where: {
            id: normalizedListingId,
            sellerId: listing.sellerId,
            archivedAt: null,
          },
          data: {
            status: ListingStatus.HIDDEN,
            isPrivate: true,
            archivedAt: new Date(),
          },
        });
        if (archived.count !== 1) {
          throw new ListingDeleteError("Listing state changed; refresh and try again.");
        }

        await tx.favorite.deleteMany({ where: { listingId: normalizedListingId } });
        await tx.stockNotification.deleteMany({ where: { listingId: normalizedListingId } });
        await tx.cartItem.deleteMany({ where: { listingId: normalizedListingId } });
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

      // Photo has an intentional RESTRICT foreign key. Delete the rows only
      // after media tracking has been proven; all changes roll back together
      // if the final Listing delete or its cleanup trigger fails.
      await tx.photo.deleteMany({ where: { listingId: normalizedListingId } });
      const deleted = await tx.listing.deleteMany({
        where: {
          id: normalizedListingId,
          sellerId: listing.sellerId,
          archivedAt: null,
        },
      });
      if (deleted.count !== 1) {
        throw new ListingDeleteError("Listing state changed; refresh and try again.");
      }
      return "deleted";
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
  );
}
