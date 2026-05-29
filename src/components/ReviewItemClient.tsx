// src/components/ReviewItemClient.tsx
"use client";

import * as React from "react";
import { useToast } from "@/components/Toast";

export function HelpfulButton({
  reviewId,
  initialCount,
  initiallyVoted,
  canVote,
  signedIn,
}: {
  reviewId: string;
  initialCount: number;
  initiallyVoted: boolean;
  /** Eligible to vote (signed in, not the seller, not the reviewer). */
  canVote: boolean;
  /** Whether the viewer is signed in at all. Signed-out viewers click to
   * sign-in instead of getting a silently-disabled button. */
  signedIn: boolean;
}) {
  const [count, setCount] = React.useState(initialCount);
  const [voted, setVoted] = React.useState(initiallyVoted);
  const [loading, setLoading] = React.useState(false);
  const { toast } = useToast();

  async function toggle() {
    if (loading) return;
    if (!signedIn) {
      if (typeof window !== "undefined" && window.location) {
        window.location.href = `/sign-in?redirect_url=${encodeURIComponent(window.location.pathname + window.location.hash)}`;
      }
      return;
    }
    if (!canVote) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/reviews/${reviewId}/vote`, { method: "POST" });
      const j = await res.json();
      if (res.ok) {
        setCount(j.helpfulCount);
        setVoted(j.voted);
      } else {
        toast(j?.error || "Failed", "error");
      }
    } catch {
      toast("Failed", "error");
    } finally {
      setLoading(false);
    }
  }

  const disabled = signedIn && !canVote;
  const titleText = !signedIn
    ? "Sign in to mark helpful"
    : !canVote
    ? "You can't vote on this review"
    : voted
    ? "Marked helpful"
    : "Mark helpful";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled || loading}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
        voted
          ? "bg-neutral-900 text-white hover:bg-neutral-700"
          : "bg-[#EFEAE0] text-neutral-800 hover:bg-[#E3DCCB]"
      }`}
      title={titleText}
    >
      <svg
        className="h-3.5 w-3.5"
        viewBox="0 0 24 24"
        fill={voted ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={voted ? 0 : 1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
      </svg>
      <span className="tabular-nums">{count}</span>
      <span className="sr-only">Helpful</span>
    </button>
  );
}

export function SellerReplyForm({
  reviewId,
  canReply,
}: {
  reviewId: string;
  canReply: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const { toast } = useToast();

  if (!canReply) return null;

  async function submit() {
    if (!text.trim() || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/reviews/${reviewId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const j = await res.json();
      if (!res.ok) {
        toast(j?.error || "Failed to reply", "error");
      } else {
        window.location.reload();
      }
    } catch {
      toast("Failed to reply", "error");
    } finally {
      setLoading(false);
    }
  }

  return open ? (
    <div className="mt-2 w-full space-y-2">
      <textarea
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-stone-500 focus-visible:outline-none focus-visible:shadow-none"
        placeholder="Write a public reply…"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={loading || !text.trim()}
          className="inline-flex items-center rounded-md bg-[#2C1F1A] text-white px-4 py-2 text-sm font-semibold hover:bg-[#3A2A24] disabled:opacity-50 transition-colors"
        >
          {loading ? "Posting…" : "Post reply"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-neutral-600 hover:underline"
        >
          Cancel
        </button>
      </div>
    </div>
  ) : (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="inline-flex items-center rounded-full bg-[#EFEAE0] hover:bg-[#E3DCCB] px-3 py-1 text-xs font-medium text-neutral-800 transition-colors"
    >
      Reply as seller
    </button>
  );
}
