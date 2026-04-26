"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";

export function DeleteOwnReviewButton({ reviewId }: { reviewId: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function handleDelete() {
    if (!confirm("Delete this review? This cannot be undone.")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/reviews/${reviewId}`, { method: "DELETE" });
      if (!res.ok) {
        let message = "Failed to delete review.";
        try {
          const body = await res.json();
          if (typeof body?.error === "string") message = body.error;
        } catch {
          // Keep the generic message for non-JSON failures.
        }
        toast(message, "error");
        return;
      }
      toast("Review deleted.");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={loading}
      className="text-xs font-medium text-red-600 hover:text-red-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? "Deleting..." : "Delete"}
    </button>
  );
}
