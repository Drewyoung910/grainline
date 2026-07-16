// src/components/SellerRefundPanel.tsx
"use client";
import * as React from "react";
import { DEFAULT_CURRENCY, formatCurrencyCents, parseMoneyInputToCents } from "@/lib/money";
import { isAmbiguousRefundState, isRefundProcessingState } from "@/lib/refundLockState";

type Props = {
  orderId: string;
  currency: string;
  orderTotalCents: number;
  alreadyRefundedId: string | null;
  alreadyRefundedCents: number | null;
  restorableItems?: RestorableRefundItem[];
  canRestoreStock?: boolean;
};

type RestorableRefundItem = {
  listingId: string;
  title: string;
  quantity: number;
};

function fmtMoney(cents: number, currency = DEFAULT_CURRENCY) {
  return formatCurrencyCents(cents, currency);
}

function parseRestoreQuantity(value: string) {
  if (!value.trim()) return 0;
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity < 0) return null;
  return quantity;
}

export default function SellerRefundPanel({
  orderId,
  currency,
  orderTotalCents,
  alreadyRefundedId,
  alreadyRefundedCents,
  restorableItems = [],
  canRestoreStock = false,
}: Props) {
  const effectiveMax = orderTotalCents;
  const [mode, setMode] = React.useState<"idle" | "full" | "partial">("idle");
  const [partialAmount, setPartialAmount] = React.useState("");
  const [restoreQuantities, setRestoreQuantities] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ refundAmountCents: number } | null>(null);
  const refundProcessing = isRefundProcessingState(alreadyRefundedId);
  const refundAmbiguous = isAmbiguousRefundState(alreadyRefundedId);

  if (refundProcessing && !result) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <div className="font-semibold">{refundAmbiguous ? "Refund needs review" : "Refund processing"}</div>
        <div className="mt-1">
          {refundAmbiguous
            ? "Stripe refund status is unclear. Staff must reconcile this order before another refund is attempted."
            : "Stripe is processing this refund. Refresh in a few minutes before trying again."}
        </div>
      </div>
    );
  }

  if (alreadyRefundedId && !result) {
    return (
      <div className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900">
        <div className="font-semibold">Refund issued</div>
        {alreadyRefundedCents != null && (
          <div>Amount: {fmtMoney(alreadyRefundedCents, currency)}</div>
        )}
        <div className="text-xs text-green-700 mt-1">Stripe refund ID: {alreadyRefundedId}</div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900">
        <div className="font-semibold">Refund issued successfully</div>
        <div>Amount refunded: {fmtMoney(result.refundAmountCents, currency)}</div>
      </div>
    );
  }

  async function submit(type: "FULL" | "PARTIAL") {
    let amountCents: number | null = null;

    if (type === "PARTIAL") {
      amountCents = parseMoneyInputToCents(partialAmount);
      if (amountCents === null || amountCents <= 0) {
        setError("Enter a valid refund amount.");
        return;
      }
      if (amountCents > effectiveMax) {
        setError(`Refund amount cannot exceed ${fmtMoney(effectiveMax, currency)}.`);
        return;
      }
    }

    const restoreStock: Array<{ listingId: string; quantity: number }> = [];
    if (type === "PARTIAL" && canRestoreStock) {
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

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/refund`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type,
          ...(amountCents != null ? { amountCents } : {}),
          ...(restoreStock.length > 0 ? { restoreStock } : {}),
        }),
      });
      let data: Record<string, unknown> | null = null;
      try {
        data = await res.json();
      } catch {
        // non-JSON response
      }
      if (!res.ok) {
        const msg =
          (typeof data?.error === "string" && data.error) ||
          (typeof data?.message === "string" && data.message) ||
          `Refund failed (${res.status})`;
        throw new Error(msg);
      }
      setResult({ refundAmountCents: (data as Record<string, number>).refundAmountCents });
      setMode("idle");
      setRestoreQuantities({});
    } catch (e) {
      setError((e as Error).message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card-section p-4 space-y-3">
      <div className="font-medium text-neutral-800">Cancel &amp; Refund Order</div>

      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        This will immediately refund the buyer via Stripe. This action cannot be undone.
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => { setMode("full"); setError(null); }}
            className="inline-flex min-h-[38px] items-center justify-center rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-50"
          >
            Full Refund ({fmtMoney(effectiveMax, currency)})
          </button>
          <button
            onClick={() => { setMode("partial"); setError(null); }}
            className="inline-flex min-h-[38px] items-center justify-center rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-50"
          >
            Partial Refund…
          </button>
        </div>
      )}

      {mode === "full" && (
        <div className="space-y-2">
          <p className="text-sm text-neutral-700">
            Refund{" "}
            <span className="font-medium">{fmtMoney(effectiveMax, currency)}</span> to the buyer?
          </p>
          {canRestoreStock && restorableItems.length > 0 && (
            <p className="text-xs text-neutral-500">
              Eligible in-stock items are returned to inventory automatically before handoff.
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => submit("FULL")}
              disabled={loading}
              className="inline-flex min-h-[38px] items-center justify-center rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              {loading ? "Processing…" : "Confirm Full Refund"}
            </button>
            <button
              onClick={() => setMode("idle")}
              disabled={loading}
              className="inline-flex min-h-[38px] items-center justify-center rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "partial" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm text-neutral-600">$</span>
            <input
              type="text"
              inputMode="decimal"
              pattern={"\\d+(\\.\\d{1,2})?|\\.\\d{1,2}"}
              value={partialAmount}
              onChange={(e) => { setPartialAmount(e.target.value); setError(null); }}
              placeholder="0.00"
              className="w-28 rounded-md border border-neutral-200 bg-white px-3 py-2 text-base shadow-sm outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200 sm:text-sm"
            />
            <span className="text-xs text-neutral-500">
              max {fmtMoney(effectiveMax, currency)}
            </span>
          </div>
          <p className="text-xs text-neutral-500">
            Tax is refunded automatically by Stripe in proportion to the refund amount.
          </p>
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
                    />
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => submit("PARTIAL")}
              disabled={loading || !partialAmount}
              className="inline-flex min-h-[38px] items-center justify-center rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              {loading ? "Processing…" : "Confirm Partial Refund"}
            </button>
            <button
              onClick={() => setMode("idle")}
              disabled={loading}
              className="inline-flex min-h-[38px] items-center justify-center rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
