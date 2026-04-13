"use client";
import * as React from "react";
import {
  hideListingAction,
  unhideListingAction,
  markSoldAction,
  deleteListingAction,
  publishListingAction,
} from "./actions";

interface Props {
  listingId: string;
  status: string;
}

export default function ShopListingActions({ listingId, status }: Props) {
  const [isPending, startTransition] = React.useTransition();
  const [toast, setToast] = React.useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <div className="mt-1 flex flex-wrap gap-1 px-0.5">
      {toast && (
        <span className="w-full text-[10px] text-neutral-500">{toast}</span>
      )}

      {/* Publish — for DRAFT or HIDDEN listings */}
      {(status === "DRAFT" || status === "HIDDEN") && (
        <button
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await publishListingAction(listingId);
              if (result.status === "ACTIVE") {
                showToast("Published!");
              } else {
                showToast("Sent for review.");
              }
            })
          }
          className="text-[11px] rounded border border-green-400 text-green-700 px-2 py-0.5 hover:bg-green-50 disabled:opacity-50"
        >
          Publish
        </button>
      )}

      {/* Hide — for ACTIVE listings */}
      {status === "ACTIVE" && (
        <button
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await hideListingAction(listingId);
              showToast("Hidden.");
            })
          }
          className="text-[11px] rounded border border-neutral-300 text-neutral-600 px-2 py-0.5 hover:bg-neutral-50 disabled:opacity-50"
        >
          Hide
        </button>
      )}

      {/* Unhide — for HIDDEN listings (in addition to Publish) */}
      {status === "HIDDEN" && (
        <button
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await unhideListingAction(listingId);
              showToast("Listing is now active.");
            })
          }
          className="text-[11px] rounded border border-neutral-300 text-neutral-600 px-2 py-0.5 hover:bg-neutral-50 disabled:opacity-50"
        >
          Unhide
        </button>
      )}

      {/* Mark Sold — for ACTIVE listings */}
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

      {/* Delete — for DRAFT listings */}
      {status === "DRAFT" && (
        <button
          disabled={isPending}
          onClick={() => {
            if (!window.confirm("Delete this listing?")) return;
            startTransition(async () => {
              await deleteListingAction(listingId);
            });
          }}
          className="text-[11px] rounded border border-red-300 text-red-600 px-2 py-0.5 hover:bg-red-50 disabled:opacity-50"
        >
          Delete
        </button>
      )}

      {/* Edit link always shown */}
      <a
        href={`/dashboard/listings/${listingId}/edit`}
        className="text-[11px] text-neutral-500 hover:text-neutral-800 hover:underline ml-auto"
      >
        Edit →
      </a>
    </div>
  );
}
