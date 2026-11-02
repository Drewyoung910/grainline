"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";

export function DeleteListingButton({
  listingId,
  reviewedAt,
}: {
  listingId: string;
  reviewedAt: string;
}) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function handleDelete() {
    if (!confirm("Remove this listing from Grainline? It will be rejected and removed from public view. Only the staff audit-log undo can restore it.")) return;
    setLoading(true);
    const res = await fetch(`/api/admin/listings/${listingId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewedAt }),
    });
    setLoading(false);
    if (res.ok) router.refresh();
    else {
      const data = await res.json().catch(() => null);
      toast(data?.error || "Failed to remove listing", "error");
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className="text-xs text-red-600 hover:text-red-700 hover:underline disabled:opacity-50"
    >
      {loading ? "Removing…" : "Remove listing"}
    </button>
  );
}
