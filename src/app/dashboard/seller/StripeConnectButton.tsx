"use client";
import * as React from "react";
import { safeStripeRedirectUrl } from "@/lib/stripeRedirect";

export default function StripeConnectButton() {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/connect/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnUrl: "/dashboard/seller?stripe_return=1" }),
      });
      const data = await res.json();
      const redirectUrl = safeStripeRedirectUrl(data.url);
      if (redirectUrl) {
        window.location.href = redirectUrl;
      } else {
        setError("Could not start Stripe setup. Try again.");
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={loading}
        className="rounded-md bg-[#3F5D3A] text-white px-4 py-2 text-sm hover:bg-[#345030] transition-colors disabled:opacity-50"
      >
        {loading ? "Setting up…" : "Connect Stripe →"}
      </button>
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  );
}
