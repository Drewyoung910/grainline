"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";

export function DeleteListingButton({ listingId }: { listingId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function handleRemove() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/listings/${listingId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        setOpen(false);
        setReason("");
        router.refresh();
      } else {
        const data = await res.json().catch(() => null);
        toast(data?.error || "Could not remove this listing", "error");
      }
    } catch {
      toast("Could not remove this listing", "error");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-red-600 hover:text-red-700 hover:underline"
      >
        Remove listing
      </button>
    );
  }

  return (
    <form
      className="space-y-2 rounded border border-red-200 bg-red-50 p-2 text-left"
      onSubmit={(event) => {
        event.preventDefault();
        void handleRemove();
      }}
    >
      <label className="block text-xs font-medium text-red-900" htmlFor={`remove-reason-${listingId}`}>
        Reason shown to the maker. The listing goes down at once and the maker cannot edit or resubmit it.
      </label>
      <textarea
        id={`remove-reason-${listingId}`}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={500}
        rows={3}
        className="w-full rounded border border-red-200 bg-white px-2 py-1 text-sm"
      />
      <div className="flex gap-2">
        <button type="submit" disabled={loading || !reason.trim()} className="btn btn-danger-solid btn-sm">
          {loading ? "Removing..." : "Confirm removal"}
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            setOpen(false);
            setReason("");
          }}
          className="btn btn-secondary btn-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
