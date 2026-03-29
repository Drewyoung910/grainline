// src/components/CaseReplyBox.tsx
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function CaseReplyBox({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/cases/${caseId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to send");
      setLoading(false);
      return;
    }
    setBody("");
    setLoading(false);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Write a reply…"
        className="w-full rounded border px-3 py-2 text-sm"
        disabled={loading}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={loading || !body.trim()}
        className="rounded bg-neutral-900 px-4 py-1.5 text-sm text-white disabled:opacity-50"
      >
        {loading ? "Sending…" : "Send reply"}
      </button>
    </form>
  );
}
