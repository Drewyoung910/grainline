"use client";
import * as React from "react";

export default function BlogCommentForm({
  slug,
  parentId,
  onCancel,
  placeholder,
}: {
  slug: string;
  parentId?: string;
  onCancel?: () => void;
  placeholder?: string;
}) {
  const [body, setBody] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = React.useState("Something went wrong. Please try again.");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setStatus("loading");
    setErrorMessage("Something went wrong. Please try again.");
    try {
      const res = await fetch(`/api/blog/${slug}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: body.trim(), ...(parentId ? { parentId } : {}) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error || "Something went wrong. Please try again.");
      }
      setStatus("success");
      setBody("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 flex items-center justify-between gap-3">
        <span>{parentId ? "Reply submitted! It will appear after moderation." : "Comment submitted! It will appear after moderation."}</span>
        {onCancel && (
          <button onClick={onCancel} className="text-green-700 hover:text-green-900 text-xs underline shrink-0">
            Close
          </button>
        )}
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
        placeholder={placeholder ?? "Share your thoughts…"}
        className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300 resize-none"
      />
      {status === "error" && (
        <p className="text-sm text-red-600">{errorMessage}</p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={status === "loading" || !body.trim()}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {status === "loading" ? "Posting…" : parentId ? "Post reply" : "Post comment"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-neutral-50"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
