// src/components/CaseMarkResolvedButton.tsx
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function CaseMarkResolvedButton({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function markResolved() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/cases/${caseId}/mark-resolved`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        onClick={markResolved}
        disabled={loading}
        className="rounded border border-green-300 px-3 py-1.5 text-sm text-green-700 hover:bg-green-50 disabled:opacity-50"
      >
        {loading ? "Marking…" : "Mark Resolved"}
      </button>
    </div>
  );
}
