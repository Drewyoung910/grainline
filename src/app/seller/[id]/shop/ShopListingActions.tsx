"use client";
import * as React from "react";
import {
  hideListingAction,
  unhideListingAction,
  markSoldAction,
  markAvailableAction,
  deleteListingAction,
  publishListingAction,
} from "./actions";

interface Props {
  listingId: string;
  status: string;
  isPrivate?: boolean;
}

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
          className="text-[11px] rounded border border-green-400 text-green-700 px-2 py-0.5 hover:bg-green-50 disabled:opacity-50"
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
          className="text-[11px] rounded border border-neutral-300 text-neutral-600 px-2 py-0.5 hover:bg-neutral-50 disabled:opacity-50"
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
          className="text-[11px] rounded border border-neutral-300 text-neutral-600 px-2 py-0.5 hover:bg-neutral-50 disabled:opacity-50"
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
              await markSoldAction(listingId);
              showToast("Marked as sold.");
            })
          }
          className="text-[11px] rounded border border-neutral-300 text-neutral-600 px-2 py-0.5 hover:bg-neutral-50 disabled:opacity-50"
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
          className="text-[11px] rounded border border-neutral-300 text-neutral-600 px-2 py-0.5 hover:bg-neutral-50 disabled:opacity-50"
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
          className="text-[11px] rounded border border-amber-400 text-amber-700 px-2 py-0.5 hover:bg-amber-50 disabled:opacity-50"
        >
          Resubmit for Review
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
          className="text-[11px] rounded border border-red-300 text-red-600 px-2 py-0.5 hover:bg-red-50 disabled:opacity-50"
        >
          Archive
        </button>
      )}

      {/* Edit link always shown */}
      {!isArchived && (
        <a
          href={`/dashboard/listings/${listingId}/edit`}
          className="text-[11px] text-neutral-500 hover:text-neutral-800 hover:underline ml-auto"
        >
          Edit →
        </a>
      )}
    </div>
  );
}
