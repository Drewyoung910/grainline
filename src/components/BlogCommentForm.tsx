"use client";
import * as React from "react";

export default function BlogCommentForm({ slug }: { slug: string }) {
  const [body, setBody] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "loading" | "success" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setStatus("loading");
    try {
      const res = await fetch(`/api/blog/${slug}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: body.trim() }),
      });
      if (!res.ok) throw new Error();
      setStatus("success");
      setBody("");
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        Comment submitted! It will appear after moderation.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
        rows={3}
        maxLength={2000}
        placeholder="Share your thoughts…"
        className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300 resize-none"
      />
      {status === "error" && (
        <p className="text-sm text-red-600">Something went wrong. Please try again.</p>
      )}
      <button
        type="submit"
        disabled={status === "loading" || !body.trim()}
        className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
      >
        {status === "loading" ? "Posting…" : "Post comment"}
      </button>
    </form>
  );
}
