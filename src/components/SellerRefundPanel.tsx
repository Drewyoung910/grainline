// src/components/SellerRefundPanel.tsx
"use client";
import * as React from "react";

type Props = {
  orderId: string;
  currency: string;
  orderTotalCents: number;
  alreadyRefundedId: string | null;
  alreadyRefundedCents: number | null;
};

const REFUND_LOCK_SENTINEL = "pending";

function fmtMoney(cents: number, currency = "usd") {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  });
}

export default function SellerRefundPanel({
  orderId,
  currency,
  orderTotalCents,
  alreadyRefundedId,
  alreadyRefundedCents,
}: Props) {
  const effectiveMax = orderTotalCents;
  const [mode, setMode] = React.useState<"idle" | "full" | "partial">("idle");
  const [partialAmount, setPartialAmount] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ refundAmountCents: number } | null>(null);
  const refundProcessing = alreadyRefundedId === REFUND_LOCK_SENTINEL;

  if (refundProcessing && !result) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <div className="font-semibold">Refund processing</div>
        <div className="mt-1">
          Stripe is processing this refund. Refresh in a few minutes before trying again.
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
      const parsed = parseFloat(partialAmount);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setError("Enter a valid refund amount.");
        return;
      }
      amountCents = Math.round(parsed * 100);
      if (amountCents > effectiveMax) {
        setError(`Refund amount cannot exceed ${fmtMoney(effectiveMax, currency)}.`);
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/refund`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, ...(amountCents != null ? { amountCents } : {}) }),
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
            className="rounded border px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            Full Refund ({fmtMoney(effectiveMax, currency)})
          </button>
          <button
            onClick={() => { setMode("partial"); setError(null); }}
            className="rounded border px-3 py-1.5 text-sm hover:bg-neutral-50"
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
          <div className="flex gap-2">
            <button
              onClick={() => submit("FULL")}
              disabled={loading}
              className="rounded bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {loading ? "Processing…" : "Confirm Full Refund"}
            </button>
            <button
              onClick={() => setMode("idle")}
              disabled={loading}
              className="rounded border px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50"
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
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              max={(effectiveMax / 100).toFixed(2)}
              value={partialAmount}
              onChange={(e) => { setPartialAmount(e.target.value); setError(null); }}
              placeholder="0.00"
              className="w-28 rounded border px-2 py-1 text-base sm:text-sm"
            />
            <span className="text-xs text-neutral-500">
              max {fmtMoney(effectiveMax, currency)}
            </span>
          </div>
          <p className="text-xs text-neutral-500">
            Tax is refunded automatically by Stripe in proportion to the refund amount.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => submit("PARTIAL")}
              disabled={loading || !partialAmount}
              className="rounded bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {loading ? "Processing…" : "Confirm Partial Refund"}
            </button>
            <button
              onClick={() => setMode("idle")}
              disabled={loading}
              className="rounded border px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
