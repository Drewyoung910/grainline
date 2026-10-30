"use client";
import * as React from "react";
import {
  hideListingAction,
  unhideListingAction,
  markSoldAction,
  markAvailableAction,
  deleteListingAction,
  publishListingAction,
  withdrawListingReviewAction,
} from "./actions";

interface Props {
  listingId: string;
  status: string;
}

// 32px on mouse/trackpad, 44px touch targets on coarse pointers.
const SHOP_ACTION_CLASS =
  "inline-flex min-h-8 items-center rounded-md border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 pointer-coarse:min-h-11";
const SHOP_WARNING_ACTION_CLASS =
  "inline-flex min-h-8 items-center rounded-md border border-amber-200 bg-white px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50 pointer-coarse:min-h-11";
const SHOP_SUCCESS_ACTION_CLASS =
  "inline-flex min-h-8 items-center rounded-md border border-green-200 bg-white px-3 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50 pointer-coarse:min-h-11";
const SHOP_DANGER_ACTION_CLASS =
  "inline-flex min-h-8 items-center rounded-md border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 pointer-coarse:min-h-11";

export default function ShopListingActions({ listingId, status }: Props) {
  const [isPending, startTransition] = React.useTransition();
  const [toast, setToast] = React.useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <div className="mt-1 flex flex-wrap gap-2 px-0.5">
      {toast && (
        <span className="w-full text-xs text-neutral-500">{toast}</span>
      )}

      {/* Publish — DRAFT only */}
      {status === "DRAFT" && (
        <button
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              try {
                const result = await publishListingAction(listingId);
                if ("error" in result) {
                  showToast(result.error);
                } else if (result.status === "ACTIVE") {
                  showToast("Published!");
                } else {
                  showToast("Sent for review — you'll be notified once approved.");
                }
              } catch (e) {
                showToast(e instanceof Error ? e.message : "Failed to publish.");
              }
            })
          }
          className={SHOP_SUCCESS_ACTION_CLASS}
        >
          Publish
        </button>
      )}

      {/* Hide is reversible for active and sold-out listings, including private custom listings. */}
      {(status === "ACTIVE" || status === "SOLD_OUT") && (
        <button
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await hideListingAction(listingId);
              showToast(result.ok ? "Hidden." : (result.error ?? "Could not hide this listing."));
            })
          }
          className={SHOP_ACTION_CLASS}
        >
          Hide
        </button>
      )}

      {/* Unhide — HIDDEN only */}
      {status === "HIDDEN" && (
        <button
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await unhideListingAction(listingId);
              if (result && "error" in result) {
                showToast(result.error);
              } else if (result?.status === "PENDING_REVIEW") {
                showToast("Sent for review — you'll be notified once approved.");
              } else {
                showToast("Listing is now active.");
              }
            })
          }
          className={SHOP_ACTION_CLASS}
        >
          Unhide
        </button>
      )}

      {/* Mark Sold — ACTIVE only */}
      {status === "ACTIVE" && (
        <button
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await markSoldAction(listingId);
              showToast(result?.ok ? "Marked as sold." : (result?.error ?? "Could not mark this listing sold."));
            })
          }
          className={SHOP_ACTION_CLASS}
        >
          Mark sold
        </button>
      )}

      {/* Mark Available — SOLD only */}
      {status === "SOLD" && (
        <button
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await markAvailableAction(listingId);
              if (result && "error" in result) {
                showToast(result.error);
              } else if (result?.status === "PENDING_REVIEW") {
                showToast("Sent for review — you'll be notified once approved.");
              } else {
                showToast("Listing is now active.");
              }
            })
          }
          className={SHOP_ACTION_CLASS}
        >
          Mark available
        </button>
      )}

      {/* Resubmit for Review — REJECTED only */}
      {status === "REJECTED" && (
        <button
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              try {
                const result = await publishListingAction(listingId);
                if ("error" in result) {
                  showToast(result.error);
                } else if (result.status === "ACTIVE") {
                  showToast("Published!");
                } else {
                  showToast("Resubmitted for review.");
                }
              } catch (e) {
                showToast(e instanceof Error ? e.message : "Failed to resubmit.");
              }
            })
          }
          className={SHOP_WARNING_ACTION_CLASS}
        >
          Resubmit for Review
        </button>
      )}

      {/* Withdraw — PENDING_REVIEW only */}
      {status === "PENDING_REVIEW" && (
        <button
          disabled={isPending}
          onClick={() => {
            if (!window.confirm("Withdraw this listing from review and move it back to drafts?")) return;
            startTransition(async () => {
              const result = await withdrawListingReviewAction(listingId);
              showToast(result.ok ? "Moved back to drafts." : (result.error ?? "Could not withdraw this listing."));
            });
          }}
          className={SHOP_WARNING_ACTION_CLASS}
        >
          Withdraw
        </button>
      )}

      {/* Edit link hidden while review owns the current draft state. */}
      {status !== "PENDING_REVIEW" && (
        <a
          href={`/dashboard/listings/${listingId}/edit`}
          className={SHOP_ACTION_CLASS}
        >
          Edit →
        </a>
      )}

      {/* Delete — all statuses except PENDING_REVIEW. Kept last and pushed apart
          (ml-auto + pl-2) so it is not a near-miss tap from the other actions. */}
      {status !== "PENDING_REVIEW" && (
        <div className="ml-auto flex pl-2">
          <button
            disabled={isPending}
            onClick={() => {
              if (!window.confirm("Delete this listing? This action is permanent. Saved listings and back-in-stock subscriptions will be removed. Listings required for order, review, or conversation history will be retained only as an archived record.")) return;
              startTransition(async () => {
                const result = await deleteListingAction(listingId);
                showToast(
                  result.ok
                    ? result.outcome === "archived"
                      ? "Deleted from your shop; buyer history was retained."
                      : "Deleted."
                    : (result.error ?? "Could not delete this listing."),
                );
              });
            }}
            className={SHOP_DANGER_ACTION_CLASS}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
