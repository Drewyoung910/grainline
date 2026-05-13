"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";

type Props = {
  sellerProfileId: string;
  sellerUserId: string;
  initialFollowing: boolean;
  initialCount: number;
  size?: "sm" | "md";
  /** "default" = white bordered (legacy). "cream" = dark-cream secondary
   * matching the rest of the action-row button family. */
  variant?: "default" | "cream";
};

export default function FollowButton({
  sellerProfileId,
  sellerUserId: _sellerUserId,
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

  const base =
    size === "sm"
      ? "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors disabled:opacity-60"
      : "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60";

  let style: string;
  if (variant === "cream") {
    style = following
      ? `${base} bg-neutral-900 text-white hover:bg-neutral-700`
      : `${base} bg-[#EFEAE0] text-neutral-800 hover:bg-[#E3DCCB]`;
  } else {
    // default variant — preserve legacy white-bordered look used in other surfaces
    style = following
      ? `${base} border border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-700`
      : `${base} border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50`;
  }

  return (
    <button onClick={toggle} disabled={loading} className={style}>
      {following ? "Following ✓" : "Follow"}
      <span className="text-xs opacity-70">· {count.toLocaleString("en-US")}</span>
    </button>
  );
}
