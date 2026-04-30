"use client";
import { useState } from "react";
import { useToast } from "@/components/Toast";
import { publicListingPath } from "@/lib/publicPaths";
import { stockNotificationSubscribedFromResponse } from "@/lib/stockNotificationState";

export default function NotifyMeButton({
  listingId,
  listingTitle,
  initialSubscribed,
  signedIn,
}: {
  listingId: string;
  listingTitle: string;
  initialSubscribed: boolean;
  signedIn: boolean;
}) {
  const [subscribed, setSubscribed] = useState(initialSubscribed);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  async function toggle() {
    if (!signedIn) {
      window.location.href = `/sign-in?redirect_url=${encodeURIComponent(publicListingPath(listingId, listingTitle))}`;
      return;
    }
    setLoading(true);
    try {
      const method = subscribed ? "DELETE" : "POST";
      const res = await fetch(`/api/listings/${listingId}/notify`, { method });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        const nextSubscribed = stockNotificationSubscribedFromResponse(data, !subscribed);
        setSubscribed(nextSubscribed);
        toast(nextSubscribed ? "We’ll notify you when this is back in stock." : "Stock alert removed.", "success");
        return;
      }
      let message = "Couldn’t update stock alert.";
      try {
        const data = (await res.json()) as { error?: string };
        if (data.error) message = data.error;
      } catch {
        // keep generic message
      }
      toast(message, "error");
    } catch {
      toast("Network error. Please try again.", "error");
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
          className="text-xs text-neutral-500 underline hover:text-neutral-600"
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
