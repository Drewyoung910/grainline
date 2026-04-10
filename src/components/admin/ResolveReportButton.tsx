"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function ResolveReportButton({ reportId }: { reportId: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleResolve() {
    setLoading(true);
    await fetch(`/api/admin/reports/${reportId}/resolve`, { method: "POST" });
    setLoading(false);
    router.refresh();
  }

  return (
    <button
      onClick={handleResolve}
      disabled={loading}
      className="text-xs text-neutral-600 border border-neutral-200 rounded px-3 py-1.5 hover:bg-neutral-50 disabled:opacity-50 shrink-0"
    >
      {loading ? "Resolving…" : "Resolve"}
    </button>
  );
}
