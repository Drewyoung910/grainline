"use client";
import * as React from "react";

type Step = "idle" | "address" | "loading";

export default function BuyNowButton({
  listingId,
  quantity = 1,
  className = "",
  children,
}: {
  listingId: string;
  quantity?: number;
  className?: string;
  children?: React.ReactNode;
}) {
  const [step, setStep] = React.useState<Step>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [addr, setAddr] = React.useState({
    postal: "",
    state: "",
    city: "",
    country: "US",
  });

  function patch(field: keyof typeof addr, value: string) {
    setAddr((prev) => ({ ...prev, [field]: value }));
  }

  async function startCheckout() {
    setError(null);
    setStep("loading");
    try {
      const body: Record<string, unknown> = { listingId, quantity };
      if (addr.postal.trim()) body.toPostal  = addr.postal.trim();
      if (addr.state.trim())  body.toState   = addr.state.trim();
      if (addr.city.trim())   body.toCity    = addr.city.trim();
      body.toCountry = addr.country.trim() || "US";

      const res = await fetch("/api/cart/checkout/single", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Checkout failed");
      window.location.href = data.url;
    } catch (e) {
      setError((e as Error).message);
      setStep("address");
    }
  }

  if (step === "idle") {
    return (
      <button
        type="button"
        onClick={() => setStep("address")}
        className={className || "rounded bg-black px-4 py-2 text-white text-sm disabled:opacity-50"}
      >
        {children ?? "Buy now"}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 space-y-3">
      <div className="text-sm font-medium text-neutral-800">Enter shipping destination</div>
      <p className="text-xs text-neutral-500">
        Used to pre-calculate shipping rates. You will confirm your full address at checkout.
      </p>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <input
          className="col-span-2 rounded border px-2 py-1.5 text-sm"
          placeholder="ZIP / Postal *"
          value={addr.postal}
          onChange={(e) => patch("postal", e.target.value)}
          disabled={step === "loading"}
          autoFocus
        />
        <input
          className="rounded border px-2 py-1.5 text-sm"
          placeholder="State/Region"
          value={addr.state}
          onChange={(e) => patch("state", e.target.value)}
          disabled={step === "loading"}
        />
        <input
          className="rounded border px-2 py-1.5 text-sm"
          placeholder="City"
          value={addr.city}
          onChange={(e) => patch("city", e.target.value)}
          disabled={step === "loading"}
        />
        <input
          className="rounded border px-2 py-1.5 text-sm bg-neutral-50 text-neutral-500"
          value="US"
          disabled
          aria-label="Country"
        />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={startCheckout}
          disabled={step === "loading" || !addr.postal.trim()}
          className="rounded bg-black px-4 py-2 text-white text-sm disabled:opacity-50"
        >
          {step === "loading" ? "Redirecting…" : "Continue to checkout"}
        </button>
        <button
          type="button"
          onClick={() => { setStep("idle"); setError(null); }}
          disabled={step === "loading"}
          className="text-sm text-neutral-500 hover:text-neutral-800"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
