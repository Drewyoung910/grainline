"use client";
import * as React from "react";

type Rate = {
  label: string;
  amountCents: number;
  objectId: string;
  carrier?: string;
  service?: string;
  estDays?: number | null;
};

export type LabelSectionProps = {
  orderId: string;
  labelStatus: string | null;
  labelUrl: string | null;
  labelCarrier: string | null;
  labelTrackingNumber: string | null;
  labelPurchasedAt: string | null; // ISO string
  fulfillmentStatus: string;
  shippingAmountCents: number;
  currency: string;
};

function fmtMoney(cents: number, currency = "usd") {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  });
}

const TERMINAL_STATUSES = ["SHIPPED", "DELIVERED", "PICKED_UP"];

export default function LabelSection({
  orderId,
  labelStatus,
  labelUrl,
  labelCarrier,
  labelTrackingNumber,
  labelPurchasedAt,
  fulfillmentStatus,
  shippingAmountCents,
  currency,
}: LabelSectionProps) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rates, setRates] = React.useState<Rate[] | null>(null);
  const [selectedRate, setSelectedRate] = React.useState<Rate | null>(null);
  const [confirming, setConfirming] = React.useState(false);

  // --- Purchased state ---
  if (labelStatus === "PURCHASED") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {labelUrl && (
            <a
              href={labelUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
            >
              Download Label
            </a>
          )}
          <span className="text-sm font-medium text-green-700">Label purchased</span>
        </div>
        <div className="space-y-0.5 text-xs text-neutral-500">
          {labelCarrier && <div>Carrier: {labelCarrier}</div>}
          {labelTrackingNumber && (() => {
            const c = (labelCarrier ?? "").toUpperCase();
            let url: string | null = null;
            if (c.includes("UPS")) url = `https://www.ups.com/track?tracknum=${labelTrackingNumber}`;
            else if (c.includes("USPS")) url = `https://tools.usps.com/go/TrackConfirmAction?tLabels=${labelTrackingNumber}`;
            else if (c.includes("FEDEX") || c.includes("FED EX")) url = `https://www.fedex.com/fedextrack/?trknbr=${labelTrackingNumber}`;
            else if (c.includes("DHL")) url = `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${labelTrackingNumber}`;
            return (
              <div>
                Tracking:{" "}
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80">
                    {labelTrackingNumber}
                  </a>
                ) : (
                  labelTrackingNumber
                )}
              </div>
            );
          })()}
          {labelPurchasedAt && (
            <div>Purchased: {new Date(labelPurchasedAt).toLocaleString("en-US")}</div>
          )}
        </div>
      </div>
    );
  }

  // Don't offer purchase if order is already in a terminal fulfillment state
  if (TERMINAL_STATUSES.includes(fulfillmentStatus)) return null;

  async function purchaseLabel(rateObjectId?: string) {
    setError(null);
    setLoading(true);
    try {
      const body: Record<string, unknown> = {};
      if (rateObjectId) body.rateObjectId = rateObjectId;
      const res = await fetch(`/api/orders/${orderId}/label`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.status === 202 && data.requiresRateSelection) {
        setRates(data.rates as Rate[]);
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error(data?.error || "Label purchase failed");
      // Success — reload to show updated label state
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }

  async function confirmRate() {
    if (!selectedRate) return;
    setConfirming(true);
    await purchaseLabel(selectedRate.objectId);
    setConfirming(false);
  }

  // --- Rate picker (after re-quote) ---
  if (rates) {
    return (
      <div className="space-y-3">
        <div className="text-sm font-medium text-neutral-800">Select a shipping rate</div>
        <p className="text-xs text-neutral-500">
          Your original rate expired. Select a current rate to purchase the label.
        </p>
        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
        <ul className="divide-y rounded border bg-white">
          {rates.map((r) => (
            <li key={r.objectId}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-neutral-50">
                <input
                  type="radio"
                  name="rate"
                  value={r.objectId}
                  checked={selectedRate?.objectId === r.objectId}
                  onChange={() => setSelectedRate(r)}
                  className="shrink-0"
                />
                <div className="flex-1 text-sm">
                  <span className="font-medium">{r.carrier ?? r.label}</span>
                  {r.service && r.carrier ? <span className="text-neutral-600"> {r.service}</span> : null}
                  {r.estDays ? (
                    <span className="text-neutral-500"> · {r.estDays}d est.</span>
                  ) : null}
                </div>
                <div className="text-sm font-medium tabular-nums">
                  {fmtMoney(r.amountCents, currency)}
                </div>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-3">
          <button
            onClick={confirmRate}
            disabled={!selectedRate || confirming}
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {confirming ? "Purchasing…" : "Purchase label"}
          </button>
          <button
            onClick={() => { setRates(null); setSelectedRate(null); setError(null); }}
            disabled={confirming}
            className="text-sm text-neutral-500 hover:text-neutral-800"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // --- Default: purchase button ---
  return (
    <div className="space-y-1.5">
      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
      <button
        onClick={() => purchaseLabel()}
        disabled={loading}
        className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {loading ? "Purchasing…" : "Purchase Label"}
      </button>
      {shippingAmountCents > 0 && (
        <p className="text-xs text-neutral-500">
          Estimated label cost: {fmtMoney(shippingAmountCents, currency)} (based on
          shipping charged at checkout — actual cost may vary)
        </p>
      )}
    </div>
  );
}
