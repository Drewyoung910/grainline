// src/components/SellerRefundPanel.tsx
"use client";

import * as React from "react";
import { DEFAULT_CURRENCY, formatCurrencyCents } from "@/lib/money";
import { isAmbiguousRefundState, isRefundProcessingState } from "@/lib/refundLockState";

type Props = {
  orderId: string;
  currency: string;
  orderTotalCents: number;
  alreadyRefundedId: string | null;
  alreadyRefundedCents: number | null;
};

function fmtMoney(cents: number, currency = DEFAULT_CURRENCY) {
  return formatCurrencyCents(cents, currency);
}

export default function SellerRefundPanel({
  orderId,
  currency,
  orderTotalCents,
  alreadyRefundedId,
  alreadyRefundedCents,
}: Props) {
  const [confirming, setConfirming] = React.useState(false);
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
        <div className="mt-1 text-xs text-green-700">Stripe refund ID: {alreadyRefundedId}</div>
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

  async function submitFullRefund() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/refund`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "FULL" }),
      });
      let data: Record<string, unknown> | null = null;
      try {
        data = await res.json();
      } catch {
        // Non-JSON response.
      }
      if (!res.ok) {
        const message =
          (typeof data?.error === "string" && data.error) ||
          (typeof data?.message === "string" && data.message) ||
          `Refund failed (${res.status})`;
        throw new Error(message);
      }
      setResult({ refundAmountCents: (data as Record<string, number>).refundAmountCents });
      setConfirming(false);
    } catch (caught) {
      setError((caught as Error).message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card-section space-y-3 p-4">
      <div className="font-medium text-neutral-800">Cancel &amp; Refund Order</div>

      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        This cancels and refunds the entire order through Stripe. Eligible in-stock items are
        returned to inventory automatically before handoff. This action cannot be undone.
      </div>

      <p className="text-xs text-neutral-500">
        Partial refunds require Grainline staff review so the remaining items, tax, shipping,
        fulfillment, and inventory stay consistent.
      </p>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {!confirming ? (
        <button
          onClick={() => {
            setConfirming(true);
            setError(null);
          }}
          className="inline-flex min-h-[38px] items-center justify-center rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-50"
        >
          Cancel &amp; Refund ({fmtMoney(orderTotalCents, currency)})
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-neutral-700">
            Refund <span className="font-medium">{fmtMoney(orderTotalCents, currency)}</span> to
            the buyer and cancel the order?
          </p>
          <div className="flex gap-2">
            <button
              onClick={submitFullRefund}
              disabled={loading}
              className="inline-flex min-h-[38px] items-center justify-center rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              {loading ? "Processing…" : "Confirm Full Refund"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={loading}
              className="inline-flex min-h-[38px] items-center justify-center rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50"
            >
              Keep Order
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
