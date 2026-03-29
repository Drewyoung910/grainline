// src/components/CaseEscalateButton.tsx
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function CaseEscalateButton({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function escalate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/cases/${caseId}/escalate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to escalate");
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
        onClick={escalate}
        disabled={loading}
        className="rounded border border-purple-300 px-3 py-1.5 text-sm text-purple-700 hover:bg-purple-50 disabled:opacity-50"
      >
        {loading ? "Escalating…" : "Escalate to Staff"}
      </button>
    </div>
  );
}
