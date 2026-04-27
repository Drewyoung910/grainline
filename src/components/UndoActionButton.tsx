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
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { toast } = useToast();

  if (!canUndo || done) {
    return (
      <span className="text-xs text-neutral-400">
        {done ? "Undone" : "Expired"}
      </span>
    );
  }

  async function handleUndo() {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      toast("Add a reason before undoing this action.", "error");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/admin/audit/${logId}/undo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: trimmedReason }),
      });
      if (res.ok) {
        setDone(true);
        setOpen(false);
        setReason("");
      } else {
        const data = await res.json();
        toast(data.error || "Failed to undo", "error");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen((value) => !value)}
        disabled={loading}
        className="text-xs px-2 py-0.5 border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50"
      >
        Undo
      </button>
      {open && (
        <form
          className="space-y-2 rounded border border-amber-200 bg-amber-50 p-2"
          onSubmit={(event) => {
            event.preventDefault();
            void handleUndo();
          }}
        >
          <label className="block text-xs font-medium text-amber-900" htmlFor={`undo-reason-${logId}`}>
            Undo reason
          </label>
          <textarea
            id={`undo-reason-${logId}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={1000}
            rows={3}
            className="w-full rounded border border-amber-200 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading || !reason.trim()}
              className="text-xs px-3 py-1.5 bg-amber-700 text-white hover:bg-amber-800 disabled:opacity-50"
            >
              {loading ? "..." : "Confirm undo"}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                setOpen(false);
                setReason("");
              }}
              className="text-xs px-3 py-1.5 border border-neutral-300 text-neutral-700 hover:bg-white disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
