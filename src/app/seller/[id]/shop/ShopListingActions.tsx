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
  isPrivate?: boolean;
}

const SHOP_ACTION_CLASS =
  "inline-flex min-h-[30px] items-center rounded-md border border-neutral-200 bg-white px-3 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50";
const SHOP_WARNING_ACTION_CLASS =
  "inline-flex min-h-[30px] items-center rounded-md border border-amber-200 bg-white px-3 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50";
const SHOP_SUCCESS_ACTION_CLASS =
  "inline-flex min-h-[30px] items-center rounded-md border border-green-200 bg-white px-3 py-1 text-[11px] font-medium text-green-700 hover:bg-green-50 disabled:opacity-50";
const SHOP_DANGER_ACTION_CLASS =
  "inline-flex min-h-[30px] items-center rounded-md border border-red-200 bg-white px-3 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50";

export default function ShopListingActions({ listingId, status, isPrivate = false }: Props) {
  const [isPending, startTransition] = React.useTransition();
  const [toast, setToast] = React.useState<string | null>(null);
  const isArchived = status === "HIDDEN" && isPrivate;

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <div className="mt-1 flex flex-wrap gap-1 px-0.5">
      {toast && (
        <span className="w-full text-[10px] text-neutral-500">{toast}</span>
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

      {/* Hide — ACTIVE only */}
      {status === "ACTIVE" && (
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
      {status === "HIDDEN" && !isArchived && (
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

      {/* Delete — all statuses except PENDING_REVIEW */}
      {status !== "PENDING_REVIEW" && !isArchived && (
        <button
          disabled={isPending}
          onClick={() => {
            if (!window.confirm("Archive this listing? It will be removed from public pages and current carts, but retained for order history.")) return;
            startTransition(async () => {
              const result = await deleteListingAction(listingId);
              showToast(result.ok ? "Archived." : (result.error ?? "Could not archive this listing."));
            });
          }}
          className={SHOP_DANGER_ACTION_CLASS}
        >
          Archive
        </button>
      )}

      {/* Edit link hidden while review owns the current draft state. */}
      {!isArchived && status !== "PENDING_REVIEW" && (
        <a
          href={`/dashboard/listings/${listingId}/edit`}
          className="ml-auto inline-flex min-h-[30px] items-center rounded-md border border-neutral-200 bg-white px-3 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Edit →
        </a>
      )}
    </div>
  );
}
