"use client";

import { useState, useEffect, useRef } from "react";
import { readApiErrorMessage } from "@/lib/apiError";
import type { ShippingAddress, SelectedShippingRate } from "@/types/checkout";

type QuoteRate = {
  label: string;
  amountCents: number;
  carrier: string;
  service: string;
  estDays: number | null;
  objectId?: string | null;
  token?: string;
  expiresAt?: number;
};

type Props = {
  sellerId: string;
  sellerDisplayName: string;
  address: ShippingAddress;
  onSelect: (rate: SelectedShippingRate | null) => void;
  selectedRate: SelectedShippingRate | null;
  // Optional: extra fields merged into quote body.
  // For Buy Now: { mode: "single", listingId: "xxx" }
  // Omit for cart (default cart behavior preserved).
  quoteBodyExtra?: Record<string, string>;
};

function toSelectedRate(r: QuoteRate, index: number): SelectedShippingRate {
  return {
    objectId: r.objectId ?? `${r.carrier}-${r.service}-${index}`,
    amountCents: r.amountCents,
    displayName: r.label,
    carrier: r.carrier,
    estDays: r.estDays,
    // Unsigned rates get empty token — checkout verification fails closed.
    token: r.token ?? "",
    expiresAt: r.expiresAt ?? 0,
  };
}

export default function ShippingRateSelector({
  sellerId,
  sellerDisplayName,
  address,
  onSelect,
  selectedRate,
  quoteBodyExtra,
}: Props) {
  const [rates, setRates] = useState<SelectedShippingRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("Unable to get shipping rates. Check the address or try again before continuing.");
  const [warningMessage, setWarningMessage] = useState("");
  const selectedRateRef = useRef<SelectedShippingRate | null>(selectedRate);

  const quoteBodyStr = JSON.stringify(quoteBodyExtra ?? null);

  useEffect(() => {
    selectedRateRef.current = selectedRate;
  }, [selectedRate]);

  useEffect(() => {
    const ac = new AbortController();
    async function fetchRates() {
      setLoading(true);
      setError(false);
      setErrorMessage("Unable to get shipping rates. Check the address or try again before continuing.");
      setWarningMessage("");
      setRates([]);
      try {
        const res = await fetch("/api/shipping/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ac.signal,
          body: JSON.stringify({
            mode: "cart",
            sellerId,
            ...quoteBodyExtra,
            toPostal: address.postalCode,
            toState: address.state,
            toCity: address.city,
            toCountry: "US",
            toName: address.name,
            toLine1: address.line1,
            toLine2: address.line2,
          }),
        });
        if (!res.ok) {
          throw new Error(await readApiErrorMessage(
            res,
            "Unable to get shipping rates. Check the address or try again before continuing.",
          ));
        }
        const data = await res.json();
        const quoteRates: QuoteRate[] = data.rates ?? [];
        if (quoteRates.length === 0) {
          if (typeof data.error === "string") setErrorMessage(data.error);
          onSelect(null);
          setError(true);
          return;
        }
        if (typeof data.warning === "string") setWarningMessage(data.warning);
        const mapped = quoteRates.map(toSelectedRate);
        setRates(mapped);
        const previousSelection = selectedRateRef.current;
        const matchingFreshRate = previousSelection
          ? mapped.find((rate) => rate.objectId === previousSelection.objectId)
          : null;
        const cheapest = mapped.reduce((min, r) => (r.amountCents < min.amountCents ? r : min), mapped[0]);
        onSelect(matchingFreshRate ?? cheapest);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        if ((e as Error).message) setErrorMessage((e as Error).message);
        onSelect(null);
        setError(true);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }
    fetchRates();
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sellerId, address.postalCode, address.state, address.city, address.line1, address.line2, address.name, quoteBodyStr]);

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
          {errorMessage}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-neutral-500">Shipping from {sellerDisplayName}</p>
      {warningMessage && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {warningMessage}
        </div>
      )}
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
                  <span className="text-xs text-neutral-500 ml-1">
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
