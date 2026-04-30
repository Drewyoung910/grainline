"use client";
import * as React from "react";

async function postJSON(url: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed: ${res.status}`);
  return data;
}

export default function PayoutsPage() {
  const [loading, setLoading] = React.useState<string | null>(null);
  const go = (fn: () => Promise<void>) => async () => {
    try { setLoading("…"); await fn(); } finally { setLoading(null); }
  };

  return (
    <main className="mx-auto max-w-xl p-8 space-y-4">
      <h1 className="text-2xl font-semibold">Payouts</h1>
      <p className="text-neutral-700">Connect your Stripe account to receive payments.</p>

      <div className="flex gap-3">
        <button
          className="rounded bg-black px-4 py-2 text-white text-sm disabled:opacity-50"
          disabled={!!loading}
          onClick={go(async () => {
            const { url } = await postJSON("/api/stripe/connect/create");
            window.location.href = url;
          })}
        >
          {loading ? "Loading…" : "Connect with Stripe"}
        </button>

        <button
          className="rounded border px-4 py-2 text-sm disabled:opacity-50"
          disabled={!!loading}
          onClick={go(async () => {
            const { url } = await postJSON("/api/stripe/connect/dashboard");
            window.location.href = url;
          })}
        >
          Open Stripe dashboard
        </button>
      </div>
    </main>
  );
}
