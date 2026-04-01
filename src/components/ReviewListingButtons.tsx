"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReviewListingButtons({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState<"approve" | "reject" | null>(null);

  async function handle(action: "approve" | "reject") {
    let reason: string | null = null;
    if (action === "reject") {
      reason = window.prompt("Reason for rejection (shown to seller):");
      if (!reason?.trim()) return;
    }

    setLoading(action);
    try {
      const res = await fetch(`/api/admin/listings/${listingId}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json();
        alert(data.error || "Failed");
      }
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex gap-2">
      <button
        onClick={() => handle("approve")}
        disabled={loading !== null}
        className="text-sm px-3 py-1.5 bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
      >
        {loading === "approve" ? "..." : "Approve"}
      </button>
      <button
        onClick={() => handle("reject")}
        disabled={loading !== null}
        className="text-sm px-3 py-1.5 border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {loading === "reject" ? "..." : "Reject"}
      </button>
    </div>
  );
}
