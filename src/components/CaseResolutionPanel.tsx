// src/components/CaseResolutionPanel.tsx
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseMoneyInputToCents } from "@/lib/money";

export default function CaseResolutionPanel({
  caseId,
  currency,
  restorableItems = [],
  canRestoreStock = false,
}: {
  caseId: string;
  currency: string;
  restorableItems?: RestorableCaseRefundItem[];
  canRestoreStock?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPartial, setShowPartial] = useState(false);
  const [partialAmount, setPartialAmount] = useState("");
  const [restoreQuantities, setRestoreQuantities] = useState<Record<string, string>>({});

  type RestoreStockRequest = Array<{ listingId: string; quantity: number }>;

  async function resolve(
    resolution: string,
    refundAmountCents?: number,
    restoreStock?: RestoreStockRequest,
  ) {
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { resolution };
      if (refundAmountCents != null) body.refundAmountCents = refundAmountCents;
      if (restoreStock && restoreStock.length > 0) body.restoreStock = restoreStock;
      const res = await fetch(`/api/cases/${caseId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let data: { error?: string } = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }
      if (!res.ok) {
        setError(data.error ?? "Failed to resolve case");
        return;
      }
      router.push("/admin/cases");
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  function handlePartialSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cents = parseMoneyInputToCents(partialAmount);
    if (cents === null || cents <= 0) {
      setError("Enter a valid refund amount.");
      return;
    }

    const restoreStock: RestoreStockRequest = [];
    if (canRestoreStock) {
      for (const item of restorableItems) {
        const quantity = parseRestoreQuantity(restoreQuantities[item.listingId] ?? "");
        if (quantity === null) {
          setError("Restore quantities must be whole numbers.");
          return;
        }
        if (quantity > item.quantity) {
          setError(`You can restore up to ${item.quantity} for ${item.title}.`);
          return;
        }
        if (quantity > 0) restoreStock.push({ listingId: item.listingId, quantity });
      }
    }

    resolve("REFUND_PARTIAL", cents, restoreStock);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => resolve("REFUND_FULL")}
          disabled={loading}
          className="rounded border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
        >
          Full Refund
        </button>
        <button
          onClick={() => setShowPartial((v) => !v)}
          disabled={loading}
          className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
        >
          Partial Refund
        </button>
        <button
          onClick={() => resolve("DISMISSED")}
          disabled={loading}
          className="rounded border border-green-300 bg-green-50 px-3 py-1.5 text-sm font-medium text-green-800 hover:bg-green-100 disabled:opacity-50"
        >
          Dismiss in Seller&apos;s Favor
        </button>
      </div>

      {showPartial && (
        <form onSubmit={handlePartialSubmit} className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-neutral-600">{currency.toUpperCase()} $</span>
            <input
              type="text"
              inputMode="decimal"
              pattern={"\\d+(\\.\\d{1,2})?|\\.\\d{1,2}"}
              placeholder="0.00"
              value={partialAmount}
              onChange={(e) => setPartialAmount(e.target.value)}
              className="w-28 rounded-md border border-neutral-200 px-2 py-1 text-sm"
              disabled={loading}
            />
          </div>

          {canRestoreStock && restorableItems.length > 0 && (
            <div className="rounded-md border border-neutral-200 bg-[#F7F5F0] p-3 text-sm">
              <div className="font-medium text-neutral-800">Restore inventory (optional)</div>
              <p className="mt-1 text-xs text-neutral-500">
                Use only when the buyer is no longer receiving these in-stock items.
              </p>
              <div className="mt-3 space-y-2">
                {restorableItems.map((item) => (
                  <label key={item.listingId} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 flex-1 truncate text-neutral-700">
                      {item.title}
                      <span className="ml-1 text-xs text-neutral-500">(max {item.quantity})</span>
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={item.quantity}
                      step={1}
                      value={restoreQuantities[item.listingId] ?? ""}
                      onChange={(e) => {
                        setRestoreQuantities((current) => ({
                          ...current,
                          [item.listingId]: e.target.value,
                        }));
                        setError(null);
                      }}
                      placeholder="0"
                      className="w-20 rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm"
                      disabled={loading}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-amber-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {loading ? "Processing…" : "Issue partial refund"}
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

type RestorableCaseRefundItem = {
  listingId: string;
  title: string;
  quantity: number;
};

function parseRestoreQuantity(value: string) {
  if (!value.trim()) return 0;
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity < 0) return null;
  return quantity;
}
