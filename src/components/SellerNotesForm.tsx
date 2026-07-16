"use client";

import { useState, useTransition } from "react";

export default function SellerNotesForm({
  orderId,
  initialNotes,
}: {
  orderId: string;
  initialNotes: string;
}) {
  const [notes, setNotes] = useState(initialNotes.trim());
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    const nextDraft = draft.trim();
    if (!nextDraft) {
      setError("Write a note before saving.");
      return;
    }
    const timestamp = new Date().toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const entry = `[${timestamp}] ${nextDraft}`;
    const nextNotes = notes ? `${notes}\n\n${entry}` : entry;
    if (Array.from(nextNotes).length > 2000) {
      setError("Seller notes can include up to 2,000 characters. Shorten or remove older notes first.");
      return;
    }

    setSaved(false);
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}/fulfillment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "update_notes", sellerNotes: nextNotes }),
        });
        if (!res.ok) {
          // The route returns a redirect (302) which fetch follows automatically
          // and returns the HTML page. A non-ok status means a real error.
          const data = await res.json().catch(() => null);
          setError(data?.error ?? "Failed to save notes");
          return;
        }
        setNotes(nextNotes);
        setDraft("");
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } catch {
        setError("Failed to save notes");
      }
    });
  }

  function handleClear() {
    if (!notes || isPending) return;
    if (!window.confirm("Clear all seller notes for this order?")) return;
    setSaved(false);
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}/fulfillment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "update_notes", sellerNotes: null }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          setError(data?.error ?? "Failed to clear notes");
          return;
        }
        setNotes("");
        setDraft("");
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } catch {
        setError("Failed to clear notes");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700">
        {notes ? (
          <div className="whitespace-pre-wrap leading-relaxed">{notes}</div>
        ) : (
          <p className="text-neutral-500">No seller notes yet.</p>
        )}
      </div>
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setSaved(false);
          setError(null);
        }}
        maxLength={2000}
        placeholder="Add a private seller note..."
        className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
        rows={3}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending || !draft.trim()}
          className="inline-flex min-h-[38px] items-center justify-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-700 disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Add note"}
        </button>
        {notes && (
          <button
            type="button"
            onClick={handleClear}
            disabled={isPending}
            className="inline-flex min-h-[38px] items-center justify-center rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50"
          >
            Clear notes
          </button>
        )}
        {saved && (
          <span className="text-sm text-green-600 font-medium">Saved!</span>
        )}
        {error && (
          <span className="text-sm text-red-600">{error}</span>
        )}
      </div>
    </div>
  );
}
