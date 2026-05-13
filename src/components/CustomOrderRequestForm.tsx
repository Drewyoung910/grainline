"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useBodyScrollLock, useDialogFocus } from "@/lib/dialogFocus";
import { parseMoneyInputToCents } from "@/lib/money";

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
  const dialogRef = React.useRef<HTMLDivElement>(null);

  useDialogFocus(open, dialogRef, handleClose);
  useBodyScrollLock(open);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const budgetRaw = String(fd.get("budget") ?? "").trim();
    const payload = {
      sellerUserId,
      description: String(fd.get("description") ?? "").trim(),
      dimensions: String(fd.get("dimensions") ?? "").trim() || undefined,
      budget: parseMoneyInputToCents(budgetRaw) != null ? budgetRaw : undefined,
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
        {triggerLabel ?? "Request a Custom Piece"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleClose();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="custom-order-dialog-title"
            tabIndex={-1}
            className="max-h-[calc(100svh-2rem)] w-full max-w-xl overflow-y-auto rounded-lg border border-neutral-200 bg-[#F7F5F0] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-neutral-200 bg-[#EDE8DC] px-6 py-4">
              <h2 id="custom-order-dialog-title" className="font-display text-xl font-semibold text-neutral-900">Request a Custom Piece</h2>
              <button
                type="button"
                onClick={handleClose}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-[#F7F5F0] text-2xl leading-none text-neutral-500 hover:text-neutral-900"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {success ? (
              <div className="space-y-4 p-6 text-center">
                <h3 className="font-display text-xl font-semibold">Request sent!</h3>
                <p className="text-sm text-neutral-600">
                  Your custom order request has been sent to {sellerName}. Check your messages for
                  their reply.
                </p>
                <div className="flex gap-3 justify-center pt-2">
                  {conversationId && (
                    <button
                      type="button"
                      onClick={() => router.push(`/messages/${conversationId}`)}
                      className="rounded-md bg-[#2C1F1A] px-4 py-2 text-sm font-medium text-white hover:bg-[#3A2A24]"
                    >
                      View Conversation
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleClose}
                    className="rounded-md border border-neutral-200 bg-[#EDE8DC] px-4 py-2 text-sm font-medium hover:bg-[#E7DFD1]"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4 p-6">
                {listingTitle && (
                  <div className="rounded-md border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
                    Requesting something similar to:{" "}
                    <span className="font-medium">{listingTitle}</span>
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-700">
                    What would you like made? <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    name="description"
                    required
                    maxLength={500}
                    rows={4}
                    placeholder="Describe what you'd like — wood type, style, purpose…"
                    className="w-full resize-none rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-700">
                    Any specific dimensions or size requirements?
                  </label>
                  <input
                    name="dimensions"
                    type="text"
                    maxLength={200}
                    placeholder='e.g. 24" wide × 12" deep × 30" tall'
                    className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-700">Your budget in USD</label>
                  <input
                    name="budget"
                    type="text"
                    inputMode="decimal"
                    pattern={"\\d+(\\.\\d{1,2})?|\\.\\d{1,2}"}
                    placeholder="e.g. 250"
                    className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-700">When do you need it?</label>
                  <select
                    name="timeline"
                    className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
                  >
                    {TIMELINE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                {error && <p className="text-sm text-red-600">{error}</p>}

                <div className="flex flex-col gap-3 pt-2 sm:flex-row">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 rounded-md bg-[#2C1F1A] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#3A2A24] disabled:opacity-50"
                  >
                    {submitting ? "Sending…" : "Send Custom Order Request"}
                  </button>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="rounded-md border border-neutral-200 bg-[#EDE8DC] px-4 py-2.5 text-sm font-medium hover:bg-[#E7DFD1]"
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
