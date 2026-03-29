"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

const TIMELINE_OPTIONS = [
  { value: "no_rush", label: "No rush (2+ months)" },
  { value: "2_months", label: "Within 2 months" },
  { value: "1_month", label: "Within 1 month" },
  { value: "2_weeks", label: "Within 2 weeks" },
];

type Props = {
  sellerUserId: string;
  sellerName: string;
  listingId?: string;
  listingTitle?: string;
  triggerLabel?: string;
  triggerClassName?: string;
};

export default function CustomOrderRequestForm({
  sellerUserId,
  sellerName,
  listingId,
  listingTitle,
  triggerLabel,
  triggerClassName,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [success, setSuccess] = React.useState(false);
  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const budgetRaw = fd.get("budget");
    const payload = {
      sellerUserId,
      description: String(fd.get("description") ?? "").trim(),
      dimensions: String(fd.get("dimensions") ?? "").trim() || undefined,
      budget: budgetRaw && String(budgetRaw).trim() ? Number(budgetRaw) : undefined,
      timeline: String(fd.get("timeline") ?? ""),
      listingId,
      listingTitle,
    };
    try {
      const res = await fetch("/api/messages/custom-order-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Something went wrong");
      }
      const data = await res.json();
      setConversationId((data as { conversationId?: string }).conversationId ?? null);
      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send request");
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    setOpen(false);
    setSuccess(false);
    setError(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          triggerClassName ??
          "inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-neutral-50"
        }
      >
        {triggerLabel ?? "🔨 Request a Custom Piece"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleClose();
          }}
        >
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Request a Custom Piece</h2>
              <button
                type="button"
                onClick={handleClose}
                className="text-2xl leading-none text-neutral-400 hover:text-neutral-900"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {success ? (
              <div className="p-6 space-y-4 text-center">
                <div className="text-4xl">🎨</div>
                <h3 className="text-lg font-semibold">Request sent!</h3>
                <p className="text-sm text-neutral-600">
                  Your custom order request has been sent to {sellerName}. Check your messages for
                  their reply.
                </p>
                <div className="flex gap-3 justify-center pt-2">
                  {conversationId && (
                    <button
                      type="button"
                      onClick={() => router.push(`/messages/${conversationId}`)}
                      className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
                    >
                      View Conversation
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleClose}
                    className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-neutral-50"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                {listingTitle && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Requesting something similar to:{" "}
                    <span className="font-medium">{listingTitle}</span>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium mb-1">
                    What would you like made? <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    name="description"
                    required
                    maxLength={500}
                    rows={4}
                    placeholder="Describe what you'd like — wood type, style, purpose…"
                    className="w-full resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Any specific dimensions or size requirements?
                  </label>
                  <input
                    name="dimensions"
                    type="text"
                    maxLength={200}
                    placeholder='e.g. 24" wide × 12" deep × 30" tall'
                    className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Your budget in USD</label>
                  <input
                    name="budget"
                    type="number"
                    min={1}
                    step={1}
                    placeholder="e.g. 250"
                    className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">When do you need it?</label>
                  <select
                    name="timeline"
                    className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
                  >
                    {TIMELINE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                {error && <p className="text-sm text-red-600">{error}</p>}

                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
                  >
                    {submitting ? "Sending…" : "Send Custom Order Request"}
                  </button>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-neutral-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
