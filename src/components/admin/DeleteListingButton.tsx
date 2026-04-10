"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteListingButton({ listingId }: { listingId: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    if (!confirm("Hide this listing? It will be set to HIDDEN and removed from public view. This can be undone by editing the listing status.")) return;
    setLoading(true);
    const res = await fetch(`/api/admin/listings/${listingId}`, { method: "DELETE" });
    setLoading(false);
    if (res.ok) router.refresh();
    else alert("Failed to hide listing");
  }

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className="text-xs text-red-600 hover:text-red-700 hover:underline disabled:opacity-50"
    >
      {loading ? "Hiding…" : "Hide listing"}
    </button>
  );
}
