"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { acknowledgeInventoryStockAttempt, prepareInventoryStockAttempt, readInventoryStockAttempt } from "@/lib/inventoryStockAttempt";

export default function InventoryQuantityControl({ listing, actorScope }: {
  listing: { id: string; stockQuantity: number | null }; actorScope: string;
}) {
  const router = useRouter();
  const { pending: contentPending } = useFormStatus();
  const [qty, setQty] = React.useState<string>(String(listing.stockQuantity ?? 0));
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const savingRef = React.useRef(false);
  const expectedQuantityRef = React.useRef(listing.stockQuantity ?? 0);
  const [pendingAttempt, setPendingAttempt] = React.useState(false);
  const [journalReady, setJournalReady] = React.useState(false);
  const journalKey = `grainline-stock:${actorScope}:${listing.id}`;

  React.useEffect(() => {
    try {
      const pending = readInventoryStockAttempt(sessionStorage, journalKey);
      setPendingAttempt(Boolean(pending));
      setJournalReady(true);
      if (pending) {
        expectedQuantityRef.current = pending.expectedQuantity;
        setQty(String(pending.quantity));
        setError("A stock save is pending. Retry it before entering another adjustment.");
        return;
      }
    } catch {
      setJournalReady(false);
      setError("Cannot recover stock save state. Check browser storage or contact support before adjusting stock.");
      return;
    }
    expectedQuantityRef.current = listing.stockQuantity ?? 0;
    setQty(String(listing.stockQuantity ?? 0));
  }, [journalKey, listing.stockQuantity]);

  async function handleSave() {
    if (savingRef.current || !journalReady || contentPending) return;
    const quantity = /^\d+$/.test(qty) ? Number(qty) : NaN;
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      setError("Enter a valid quantity (0 or more).");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const attempt = prepareInventoryStockAttempt(sessionStorage, journalKey, quantity, expectedQuantityRef.current);
      setPendingAttempt(true);
      const res = await fetch(`/api/listings/${listing.id}/stock/adjustments`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(attempt),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409 && data?.mutationNotApplied === true) {
          // Only an engine-serialized, absent-receipt rejection permits a new
          // attempt. A timeout, generic error or mismatched result never does.
          const currentQuantity = acknowledgeInventoryStockAttempt(sessionStorage, journalKey, attempt.mutationId, data);
          setPendingAttempt(false);
          expectedQuantityRef.current = currentQuantity;
          setQty(String(currentQuantity));
          router.refresh();
        }
        throw new Error(data?.error || "Save failed");
      }
      const data: unknown = await res.json().catch(() => null);
      const committedQuantity = acknowledgeInventoryStockAttempt(sessionStorage, journalKey, attempt.mutationId, data);
      setPendingAttempt(false);
      expectedQuantityRef.current = committedQuantity;
      setQty(String(committedQuantity));
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
      <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
        {error && <span className="text-xs text-red-600">{error}</span>}
        {saved && <span className="text-xs text-green-600">Saved</span>}
        <input
          type="number"
          inputMode="numeric"
          min="0"
          step="1"
          value={qty}
          disabled={saving || pendingAttempt || !journalReady || contentPending}
          onChange={(e) => { setQty(e.target.value); setSaved(false); setError(null); }}
          className="w-20 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-right shadow-sm outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200 disabled:bg-neutral-50 disabled:text-neutral-500"
          aria-label="Stock quantity"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !journalReady || contentPending}
          className="inline-flex min-h-[38px] items-center justify-center rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-50 disabled:opacity-50"
        >
          {saving ? "Saving…" : pendingAttempt ? "Retry save" : "Save stock"}
        </button>
      </div>
  );
}
