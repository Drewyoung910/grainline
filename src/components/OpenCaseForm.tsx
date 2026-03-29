// src/components/OpenCaseForm.tsx
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

const REASON_LABELS: Record<string, string> = {
  NOT_RECEIVED: "Item not received",
  NOT_AS_DESCRIBED: "Not as described",
  DAMAGED: "Item arrived damaged",
  WRONG_ITEM: "Wrong item received",
  OTHER: "Other",
};

export default function OpenCaseForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState("NOT_RECEIVED");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (description.trim().length < 20) {
      setError("Description must be at least 20 characters.");
      return;
    }
    setLoading(true);
    setError(null);
    const res = await fetch("/api/cases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, reason, description }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to open case");
      setLoading(false);
      return;
    }
    router.refresh();
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="rounded border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50"
      >
        Open a Case
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3"
    >
      <h3 className="text-sm font-semibold text-red-900">Open a Case</h3>

      <div className="space-y-1">
        <label className="text-xs font-medium text-neutral-700">Reason</label>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full rounded border bg-white px-3 py-1.5 text-sm"
          disabled={loading}
        >
          {Object.entries(REASON_LABELS).map(([val, label]) => (
            <option key={val} value={val}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-neutral-700">
          Description{" "}
          <span className="text-neutral-400">(min 20 characters)</span>
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="Describe what happened…"
          className="w-full rounded border bg-white px-3 py-2 text-sm"
          disabled={loading}
        />
        <p className="text-xs text-neutral-500">
          {description.trim().length} / 20 min
        </p>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-red-700 px-4 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {loading ? "Submitting…" : "Submit case"}
        </button>
        <button
          type="button"
          onClick={() => {
            setExpanded(false);
            setError(null);
          }}
          disabled={loading}
          className="rounded border px-4 py-1.5 text-sm hover:bg-white"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
