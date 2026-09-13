"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";

export function DeleteReviewButton({ reviewId }: { reviewId: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function handleDelete() {
    if (!confirm("Delete this review? This cannot be undone.")) return;
    setLoading(true);
    const res = await fetch(`/api/admin/reviews/${reviewId}`, { method: "DELETE" });
    setLoading(false);
    if (res.ok) router.refresh();
    else toast("Failed to delete review", "error");
  }

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className="text-xs text-red-600 hover:text-red-700 hover:underline disabled:opacity-50"
    >
      {loading ? "Deleting…" : "Delete"}
    </button>
  );
}
