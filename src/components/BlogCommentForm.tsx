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
  const bodyId = React.useId();
  const errorId = `${bodyId}-error`;

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
      <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 flex items-center justify-between gap-3">
        <span>{parentId ? "Reply submitted! It will appear after moderation." : "Comment submitted! It will appear after moderation."}</span>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-green-700 hover:text-green-900 text-xs underline shrink-0">
            Close
          </button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label htmlFor={bodyId} className="sr-only">
        {parentId ? "Reply" : "Comment"}
      </label>
      <textarea
        id={bodyId}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
        rows={3}
        maxLength={2000}
        placeholder={placeholder ?? "Share your thoughts…"}
        aria-invalid={status === "error"}
        aria-describedby={status === "error" ? errorId : undefined}
        className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm resize-none"
      />
      {status === "error" && (
        <p id={errorId} role="alert" className="text-sm text-red-600">{errorMessage}</p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={status === "loading" || !body.trim()}
          className="inline-flex items-center rounded-md bg-[#2C1F1A] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3A2A24] disabled:opacity-50 transition-colors"
        >
          {status === "loading" ? "Posting…" : parentId ? "Post reply" : "Post comment"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
