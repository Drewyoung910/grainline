"use client";
import { useState } from "react";

export default function NotifyMeButton({
  listingId,
  initialSubscribed,
  signedIn,
}: {
  listingId: string;
  initialSubscribed: boolean;
  signedIn: boolean;
}) {
  const [subscribed, setSubscribed] = useState(initialSubscribed);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (!signedIn) {
      window.location.href = `/sign-in?redirect_url=${encodeURIComponent(`/listing/${listingId}`)}`;
      return;
    }
    setLoading(true);
    try {
      const method = subscribed ? "DELETE" : "POST";
      const res = await fetch(`/api/listings/${listingId}/notify`, { method });
      if (res.ok) setSubscribed(!subscribed);
    } finally {
      setLoading(false);
    }
  }

  if (subscribed) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-neutral-600">
          You&apos;ll be notified when this is back in stock
        </span>
        <button
          onClick={toggle}
          disabled={loading}
          className="text-xs text-neutral-400 underline hover:text-neutral-600"
        >
          Unsubscribe
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className="rounded border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
    >
      {loading ? "…" : "Notify me when back in stock"}
    </button>
  );
}
