"use client";

import { useState, useEffect, useCallback } from "react";
import type { ShippingAddress, SelectedShippingRate } from "@/types/checkout";
import { FALLBACK_RATE } from "@/types/checkout";

type QuoteRate = {
  label: string;
  amountCents: number;
  carrier: string;
  service: string;
  estDays: number | null;
};

type Props = {
  sellerId: string;
  sellerDisplayName: string;
  address: ShippingAddress;
  onSelect: (rate: SelectedShippingRate) => void;
  selectedRate: SelectedShippingRate | null;
};

function toSelectedRate(r: QuoteRate, index: number): SelectedShippingRate {
  return {
    objectId: `${r.carrier}-${r.service}-${index}`,
    amountCents: r.amountCents,
    displayName: r.label,
    carrier: r.carrier,
    estDays: r.estDays,
  };
}

export default function ShippingRateSelector({
  sellerId,
  sellerDisplayName,
  address,
  onSelect,
  selectedRate,
}: Props) {
  const [rates, setRates] = useState<SelectedShippingRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchRates = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/shipping/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "cart",
          sellerId,
          toPostal: address.postalCode,
          toState: address.state,
          toCity: address.city,
          toCountry: "US",
        }),
      });
      if (!res.ok) throw new Error("Quote failed");
      const data = await res.json();
      const quoteRates: QuoteRate[] = data.rates ?? [];

      if (quoteRates.length === 0) {
        setError(true);
        onSelect(FALLBACK_RATE);
        return;
      }

      const mapped = quoteRates.map(toSelectedRate);
      setRates(mapped);

      // Auto-select cheapest
      const cheapest = mapped.reduce((min, r) => (r.amountCents < min.amountCents ? r : min), mapped[0]);
      onSelect(cheapest);
    } catch {
      setError(true);
      onSelect(FALLBACK_RATE);
    } finally {
      setLoading(false);
    }
  }, [sellerId, address.postalCode, address.state, address.city, onSelect]);

  useEffect(() => {
    fetchRates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sellerId, address.postalCode, address.state, address.city]);

  if (loading) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-neutral-500">Shipping from {sellerDisplayName}</p>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center justify-between p-3 rounded-md border border-neutral-200 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 rounded-full bg-neutral-200" />
              <div className="h-4 w-28 bg-neutral-200 rounded" />
            </div>
            <div className="h-4 w-14 bg-neutral-200 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-neutral-500">Shipping from {sellerDisplayName}</p>
        <div className="p-3 rounded-md border border-neutral-200 text-sm text-neutral-500">
          Unable to get shipping rates. A rate will be calculated at checkout.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-neutral-500">Shipping from {sellerDisplayName}</p>
      {rates.map((rate) => {
        const isSelected = selectedRate?.objectId === rate.objectId;
        return (
          <label
            key={rate.objectId}
            className={`flex items-center justify-between p-3 rounded-md border cursor-pointer transition-colors ${
              isSelected
                ? "bg-amber-50 border-amber-200"
                : "bg-white border-neutral-200 hover:border-neutral-300"
            }`}
          >
            <div className="flex items-center gap-3">
              <input
                type="radio"
                name={`shipping-${sellerId}`}
                checked={isSelected}
                onChange={() => onSelect(rate)}
                className="accent-neutral-900"
              />
              <span className="text-sm text-neutral-700">
                {rate.displayName}
                {rate.estDays != null && (
                  <span className="text-xs text-neutral-400 ml-1">
                    {rate.estDays === 1 ? "1 business day" : `${rate.estDays} business days`}
                  </span>
                )}
              </span>
            </div>
            <span className="text-sm font-medium text-neutral-900">
              {rate.amountCents === 0
                ? "Free"
                : `$${(rate.amountCents / 100).toFixed(2)}`}
            </span>
          </label>
        );
      })}
    </div>
  );
}
