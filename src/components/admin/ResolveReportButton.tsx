"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";

export function ResolveReportButton({ reportId }: { reportId: string }) {
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const router = useRouter();
  const { toast } = useToast();

  async function handleResolve() {
    if (loading) return;
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      toast("Add a resolution reason before closing the report.", "error");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/reports/${reportId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: trimmedReason }),
      });
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
      setOpen(false);
      setReason("");
      router.refresh();
    } catch {
      toast("Network error. Please try again.", "error");
    } finally {
      setLoading(false);
    }
  }

  if (open) {
    return (
      <div className="w-full max-w-sm space-y-2 rounded-md border border-neutral-200 bg-white p-3 shadow-sm">
        <label className="block text-xs font-medium text-neutral-700" htmlFor={`resolve-report-${reportId}`}>
          Resolution reason
        </label>
        <textarea
          id={`resolve-report-${reportId}`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          maxLength={500}
          className="w-full rounded-md border border-neutral-200 bg-[#F7F5F0] px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
          placeholder="Summarize what was reviewed and why this report can close."
        />
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setReason("");
            }}
            disabled={loading}
            className="rounded-md border border-neutral-200 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleResolve}
            disabled={loading || !reason.trim()}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {loading ? "Resolving…" : "Resolve"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      disabled={loading}
      className="shrink-0 rounded-md border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
    >
      Resolve
    </button>
  );
}
