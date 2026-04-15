"use client";
import { useState, useTransition } from "react";
import { publishListingAction } from "@/app/seller/[id]/shop/actions";

export default function ResubmitButton({ listingId }: { listingId: string }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <>
      <button
        disabled={isPending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            try {
              const result = await publishListingAction(listingId);
              if ("error" in result) {
                setMessage(result.error);
              } else if (result.status === "ACTIVE") {
                setMessage("Published!");
              } else {
                setMessage("Resubmitted for review.");
              }
            } catch {
              setMessage("Failed to resubmit.");
            }
          });
        }}
        className="text-xs rounded border border-amber-400 text-amber-700 px-2 py-1 hover:bg-amber-50 disabled:opacity-50"
      >
        {isPending ? "..." : "Resubmit"}
      </button>
      {message && <span className="text-[10px] text-neutral-500">{message}</span>}
    </>
  );
}
