"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

type Props = {
  requestId: string;
  sellerProfileId: string;
  initialInterested: boolean;
};

export default function CommissionInterestButton({ requestId, initialInterested }: Props) {
  const router = useRouter();
  const [interested, setInterested] = React.useState(initialInterested);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleClick() {
    if (interested || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/commission/${requestId}/interest`, { method: "POST" });
      if (res.status === 401) {
        router.push(`/sign-in?redirect_url=/commission/${requestId}`);
        return;
      }
      const data = await res.json().catch(() => null) as { conversationId?: string; error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "Could not express interest.");
        return;
      }
      if (res.ok) {
        setInterested(true);
        if (data?.conversationId) {
          router.push(`/messages/${data.conversationId}`);
        }
      }
    } catch {
      setError("Could not express interest. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (interested) {
    return (
      <span className="text-sm text-green-700 border border-green-200 bg-green-50 rounded-md px-4 py-2 shrink-0 font-medium">
        Interest Sent ✓
      </span>
    );
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={loading}
        className="text-sm font-medium rounded-md bg-neutral-900 text-white px-4 py-2 hover:bg-neutral-700 transition-colors disabled:opacity-50 whitespace-nowrap"
      >
        {loading ? "Sending…" : "Express Interest →"}
      </button>
      {error && (
        <p role="alert" className="max-w-48 text-right text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
