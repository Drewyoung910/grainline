"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";

export function ResolveReportButton({ reportId }: { reportId: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function handleResolve() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/reports/${reportId}/resolve`, { method: "POST" });
      if (!res.ok) {
        let message = "Couldn't resolve report.";
        try {
          const data = (await res.json()) as { error?: string };
          if (data.error) message = data.error;
        } catch {
          // keep generic message
        }
        toast(message, "error");
        return;
      }
      toast("Report resolved.", "success");
      router.refresh();
    } catch {
      toast("Network error. Please try again.", "error");
    } finally {
      setLoading(false);
    }
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
