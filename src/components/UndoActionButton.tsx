"use client";
import { useState } from "react";
import { useToast } from "@/components/Toast";

export function UndoActionButton({
  logId,
  canUndo,
}: {
  logId: string;
  canUndo: boolean;
}) {
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  if (!canUndo || done) {
    return (
      <span className="text-xs text-neutral-400">
        {done ? "Undone" : "Expired"}
      </span>
    );
  }

  async function handleUndo() {
    const reason = window.prompt("Reason for undoing this action:");
    if (!reason?.trim()) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/admin/audit/${logId}/undo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        setDone(true);
      } else {
        const data = await res.json();
        toast(data.error || "Failed to undo", "error");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleUndo}
      disabled={loading}
      className="text-xs px-2 py-0.5 border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50"
    >
      {loading ? "..." : "Undo"}
    </button>
  );
}
