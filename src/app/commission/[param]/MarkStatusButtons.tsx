"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export default function MarkStatusButtons({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [loading, setLoading] = React.useState<string | null>(null);

  async function updateStatus(status: string) {
    setLoading(status);
    try {
      const res = await fetch(`/api/commission/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) router.refresh();
    } finally {
      setLoading(null);
    }
  }

  return (
    <>
      <button
        onClick={() => updateStatus("FULFILLED")}
        disabled={!!loading}
        className="text-sm border border-green-600 text-green-700 px-4 py-2 hover:bg-green-50 transition-colors disabled:opacity-50"
      >
        {loading === "FULFILLED" ? "Updating…" : "Mark as Fulfilled"}
      </button>
      <button
        onClick={() => updateStatus("CLOSED")}
        disabled={!!loading}
        className="text-sm border border-neutral-300 text-neutral-600 px-4 py-2 hover:bg-neutral-50 transition-colors disabled:opacity-50"
      >
        {loading === "CLOSED" ? "Updating…" : "Close Request"}
      </button>
    </>
  );
}
