"use client";

import * as React from "react";
import { createPortal } from "react-dom";
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
  const [mounted, setMounted] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [success, setSuccess] = React.useState(false);
  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setMounted(true);
  }, []);

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

      {open && mounted && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 px-4"
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
            className="flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl bg-[#F7F5F0] shadow-xl overflow-hidden"
          >
            <div className="flex shrink-0 items-center justify-between px-5 py-3 border-b border-stone-200/60 bg-[#EFEAE0]">
              <h2 id="custom-order-dialog-title" className="text-base font-semibold">Request a Custom Piece</h2>
              <button
                type="button"
                onClick={handleClose}
                className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-full text-xl leading-none text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {success ? (
              <div className="p-5 space-y-3 text-center overflow-y-auto">
                <h3 className="text-base font-semibold">Request sent!</h3>
                <p className="text-sm text-neutral-600">
                  Your custom order request has been sent to {sellerName}. Check your messages for their reply.
                </p>
                <div className="flex gap-2 justify-center pt-1">
                  {conversationId && (
                    <button
                      type="button"
                      onClick={() => router.push(`/messages/${conversationId}`)}
                      className="rounded-md bg-[#2C1F1A] hover:bg-[#3A2A24] px-4 py-2 text-sm font-semibold text-white transition-colors"
                    >
                      View conversation
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleClose}
                    className="rounded-md bg-[#EFEAE0] hover:bg-[#E3DCCB] px-4 py-2 text-sm font-medium text-neutral-800 transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-3">
                  {listingTitle && (
                    <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Requesting something similar to:{" "}
                      <span className="font-medium">{listingTitle}</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1">
                      What would you like made? <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      name="description"
                      required
                      maxLength={500}
                      rows={3}
                      placeholder="Describe what you'd like — wood type, style, purpose…"
                      className="w-full resize-none rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1">
                      Dimensions or size
                    </label>
                    <input
                      name="dimensions"
                      type="text"
                      maxLength={200}
                      placeholder='e.g. 24" × 12" × 30"'
                      className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-neutral-700 mb-1">Budget USD</label>
                      <input
                        name="budget"
                        type="text"
                        inputMode="decimal"
                        pattern={"\\d+(\\.\\d{1,2})?|\\.\\d{1,2}"}
                        placeholder="e.g. 250"
                        className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-neutral-700 mb-1">Timeline</label>
                      <select
                        name="timeline"
                        className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
                      >
                        {TIMELINE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {error && <p className="text-sm text-red-600">{error}</p>}
                </div>

                <div className="shrink-0 flex gap-2 border-t border-stone-200/60 bg-[#EFEAE0] px-5 py-3">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 rounded-md bg-[#2C1F1A] hover:bg-[#3A2A24] px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                  >
                    {submitting ? "Sending…" : "Send request"}
                  </button>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="rounded-md bg-[#EFEAE0] hover:bg-[#E3DCCB] px-4 py-2 text-sm font-medium text-neutral-800 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
