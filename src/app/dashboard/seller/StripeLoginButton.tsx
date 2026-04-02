"use client";
import * as React from "react";

export default function StripeLoginButton({ hasStripeAccount }: { hasStripeAccount: boolean }) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!hasStripeAccount) {
    return (
      <p className="text-sm text-neutral-500">
        No Stripe account connected yet.{" "}
        <a href="/dashboard/onboarding" className="underline">Complete onboarding →</a>
      </p>
    );
  }

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/connect/login-link", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.open(data.url, "_blank");
      } else {
        setError("Could not generate Stripe link. Try again.");
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
        className="rounded-md bg-neutral-900 text-white px-4 py-2 text-sm hover:bg-neutral-800 transition-colors disabled:opacity-50"
      >
        {loading ? "Opening…" : "Go to Stripe Dashboard →"}
      </button>
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  );
}
