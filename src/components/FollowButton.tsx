"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import RollingNumber from "@/components/RollingNumber";

type Props = {
  sellerProfileId: string;
  initialFollowing: boolean;
  initialCount: number;
  size?: "sm" | "md";
  /** "default" = white bordered (legacy). "cream" = dark-cream secondary
   * matching the rest of the action-row button family. */
  variant?: "default" | "cream";
};

export default function FollowButton({
  sellerProfileId,
  initialFollowing,
  initialCount,
  size = "md",
  variant = "default",
}: Props) {
  const router = useRouter();
  const [following, setFollowing] = React.useState(initialFollowing);
  const [count, setCount] = React.useState(initialCount);
  const [loading, setLoading] = React.useState(false);
  const { toast } = useToast();

  async function toggle() {
    if (loading) return;
    setLoading(true);

    const previousFollowing = following;
    const previousCount = count;
    const nextFollowing = !following;
    setFollowing(nextFollowing);
    setCount(Math.max(0, count + (nextFollowing ? 1 : -1)));

    const method = previousFollowing ? "DELETE" : "POST";
    try {
      const res = await fetch(`/api/follow/${sellerProfileId}`, { method });
      if (res.status === 401) {
        setFollowing(previousFollowing);
        setCount(previousCount);
        router.push(`/sign-in?redirect_url=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      if (res.ok) {
        const data = (await res.json()) as { following: boolean; followerCount: number; error?: string };
        setFollowing(data.following);
        setCount(data.followerCount);
        return;
      }
      let message = "Couldn’t update follow status.";
      try {
        const data = (await res.json()) as { error?: string };
        if (data.error) message = data.error;
      } catch {
        // keep generic message
      }
      setFollowing(previousFollowing);
      setCount(previousCount);
      toast(message, "error");
    } catch {
      setFollowing(previousFollowing);
      setCount(previousCount);
      toast("Network error. Please try again.", "error");
    } finally {
      setLoading(false);
    }
  }

  // Prototype pill buttons: Follow is the primary action; once following it
  // settles into the quieter secondary pill. Both variants share the pills;
  // `variant` is kept for callers that still pass it.
  const base = size === "sm" ? "btn btn-sm" : "btn";
  const style = following ? `${base} btn-secondary` : `${base} btn-primary`;

  return (
    <button type="button" onClick={toggle} aria-busy={loading || undefined} aria-pressed={following} data-variant={variant} className={style}>
      {following ? <>Following <span aria-hidden="true">✓</span></> : "Follow"}
      <span className="text-xs opacity-70">· <RollingNumber value={count} /></span>
    </button>
  );
}
