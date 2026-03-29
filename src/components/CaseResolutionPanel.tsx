// src/components/CaseResolutionPanel.tsx
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function CaseResolutionPanel({
  caseId,
  currency,
}: {
  caseId: string;
  currency: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPartial, setShowPartial] = useState(false);
  const [partialAmount, setPartialAmount] = useState("");

  async function resolve(resolution: string, refundAmountCents?: number) {
    setLoading(true);
    setError(null);
    const body: Record<string, unknown> = { resolution };
    if (refundAmountCents != null) body.refundAmountCents = refundAmountCents;
    const res = await fetch(`/api/cases/${caseId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to resolve case");
      setLoading(false);
      return;
    }
    router.push("/admin/cases");
  }

  function handlePartialSubmit(e: React.FormEvent) {
    e.preventDefault();
    const dollars = parseFloat(partialAmount);
    if (!isFinite(dollars) || dollars <= 0) {
      setError("Enter a valid refund amount.");
      return;
    }
    resolve("REFUND_PARTIAL", Math.round(dollars * 100));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => resolve("REFUND_FULL")}
          disabled={loading}
          className="rounded border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
        >
          Full Refund
        </button>
        <button
          onClick={() => setShowPartial((v) => !v)}
          disabled={loading}
          className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
        >
          Partial Refund
        </button>
        <button
          onClick={() => resolve("DISMISSED")}
          disabled={loading}
          className="rounded border border-green-300 bg-green-50 px-3 py-1.5 text-sm font-medium text-green-800 hover:bg-green-100 disabled:opacity-50"
        >
          Dismiss in Seller&apos;s Favor
        </button>
      </div>

      {showPartial && (
        <form onSubmit={handlePartialSubmit} className="flex items-center gap-2">
          <span className="text-sm text-neutral-600">{currency.toUpperCase()} $</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            placeholder="0.00"
            value={partialAmount}
            onChange={(e) => setPartialAmount(e.target.value)}
            className="w-28 rounded border px-2 py-1 text-sm"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded bg-amber-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {loading ? "Processing…" : "Issue partial refund"}
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
