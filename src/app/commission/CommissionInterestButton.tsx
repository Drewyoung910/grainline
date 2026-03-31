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

  async function handleClick() {
    if (interested || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/commission/${requestId}/interest`, { method: "POST" });
      if (res.status === 401) {
        router.push(`/sign-in?redirect_url=/commission/${requestId}`);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setInterested(true);
        if (data.conversationId) {
          router.push(`/messages/${data.conversationId}`);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  if (interested) {
    return (
      <span className="text-xs text-green-700 border border-green-200 bg-green-50 px-3 py-1.5 shrink-0">
        Interest Sent ✓
      </span>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="text-xs border border-neutral-900 px-3 py-1.5 hover:bg-neutral-900 hover:text-white transition-colors disabled:opacity-50 shrink-0 whitespace-nowrap"
    >
      {loading ? "Sending…" : "Express Interest →"}
    </button>
  );
}
