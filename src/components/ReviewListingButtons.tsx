"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";

export function ReviewListingButtons({ listingId }: { listingId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState<"approve" | "reject" | null>(null);
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [reason, setReason] = useState("");

  async function handle(action: "approve" | "reject", rejectReason?: string) {
    const trimmedReason = rejectReason?.trim() ?? null;
    if (action === "reject" && !trimmedReason) {
      toast("Add a rejection reason for the seller.", "error");
      return;
    }

    setLoading(action);
    try {
      const res = await fetch(`/api/admin/listings/${listingId}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: trimmedReason }),
      });
      if (res.ok) {
        setShowRejectReason(false);
        setReason("");
        router.refresh();
      } else {
        const data = await res.json();
        toast(data.error || "Failed", "error");
      }
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          onClick={() => handle("approve")}
          disabled={loading !== null}
          className="text-sm px-3 py-1.5 bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
        >
          {loading === "approve" ? "..." : "Approve"}
        </button>
        <button
          onClick={() => setShowRejectReason((value) => !value)}
          disabled={loading !== null}
          className="text-sm px-3 py-1.5 border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Reject
        </button>
      </div>

      {showRejectReason && (
        <form
          className="space-y-2 rounded border border-red-200 bg-red-50 p-2"
          onSubmit={(event) => {
            event.preventDefault();
            void handle("reject", reason);
          }}
        >
          <label className="block text-xs font-medium text-red-900" htmlFor={`reject-reason-${listingId}`}>
            Rejection reason shown to seller
          </label>
          <textarea
            id={`reject-reason-${listingId}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={1000}
            rows={3}
            className="w-full rounded border border-red-200 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading !== null || !reason.trim()}
              className="text-xs px-3 py-1.5 bg-red-700 text-white hover:bg-red-800 disabled:opacity-50"
            >
              {loading === "reject" ? "..." : "Confirm reject"}
            </button>
            <button
              type="button"
              disabled={loading !== null}
              onClick={() => {
                setShowRejectReason(false);
                setReason("");
              }}
              className="text-xs px-3 py-1.5 border border-neutral-300 text-neutral-700 hover:bg-white disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
