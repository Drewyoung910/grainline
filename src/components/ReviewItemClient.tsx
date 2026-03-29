// src/components/ReviewItemClient.tsx
"use client";

import * as React from "react";

export function HelpfulButton({
  reviewId,
  initialCount,
  initiallyVoted,
  canVote,
}: {
  reviewId: string;
  initialCount: number;
  initiallyVoted: boolean;
  canVote: boolean;
}) {
  const [count, setCount] = React.useState(initialCount);
  const [voted, setVoted] = React.useState(initiallyVoted);
  const [loading, setLoading] = React.useState(false);

  async function toggle() {
    if (!canVote || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/reviews/${reviewId}/vote`, { method: "POST" });
      const j = await res.json();
      if (res.ok) {
        setCount(j.helpfulCount);
        setVoted(j.voted);
      } else {
        alert(j?.error || "Failed");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!canVote || loading}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${voted ? "bg-black text-white" : "hover:bg-neutral-50"}`}
      title={canVote ? "Mark helpful" : "Only buyers can vote"}
    >
      👍 <span className="tabular-nums">{count}</span>
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
        alert(j?.error || "Failed to reply");
      } else {
        window.location.reload();
      }
    } finally {
      setLoading(false);
    }
  }

  return open ? (
    <div className="mt-2 space-y-2">
      <textarea
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded border px-2 py-1 text-sm"
        placeholder="Write a public reply…"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={loading || !text.trim()}
          className="rounded border px-2 py-1 text-sm hover:bg-neutral-50"
        >
          Post reply
        </button>
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-neutral-500 hover:underline"
        >
          Cancel
        </button>
      </div>
    </div>
  ) : (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="text-xs underline"
    >
      Reply as seller
    </button>
  );
}
