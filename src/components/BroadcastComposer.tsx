"use client";

import * as React from "react";

type Broadcast = {
  id: string;
  message: string;
  imageUrl: string | null;
  sentAt: string;
  recipientCount: number;
};

function broadcastErrorMessage(data: { error?: string; nextAvailableAt?: string } | null) {
  const base = data?.error ?? "Failed to send";
  if (!data?.nextAvailableAt) return base;
  const next = new Date(data.nextAvailableAt);
  if (Number.isNaN(next.getTime())) return base;
  return `${base} Next available: ${next.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

export default function BroadcastComposer({ followerCount }: { followerCount: number }) {
  const [message, setMessage] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sellersOnly, setSellersOnly] = React.useState(false);
  const [broadcasts, setBroadcasts] = React.useState<Broadcast[] | null>(null);
  const [loadingHistory, setLoadingHistory] = React.useState(false);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoadingHistory(true);
    fetch("/api/seller/broadcast", { signal: controller.signal })
      .then((r) => r.json())
      .then((data: { broadcasts: Broadcast[] }) => {
        if (!controller.signal.aborted) setBroadcasts(data.broadcasts ?? []);
      })
      .catch((error) => {
        if (!controller.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) {
          setBroadcasts([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingHistory(false);
      });
    return () => controller.abort();
  }, [sent]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/seller/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, sellersOnly }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string; nextAvailableAt?: string } | null;
        setError(broadcastErrorMessage(data));
        return;
      }
      setMessage("");
      setSent((v) => !v); // toggle to trigger useEffect reload
    } catch {
      setError("Failed to send — please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSend} className="space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1">
            Message to your followers
            <span className="ml-2 text-neutral-500 font-normal">({followerCount} follower{followerCount !== 1 ? "s" : ""})</span>
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={500}
            rows={4}
            placeholder="Share a shop update, new project, or announcement…"
            className="w-full border border-neutral-200 bg-white rounded-md px-3 py-2 text-sm resize-none"
          />
          <p className="text-xs text-neutral-500 text-right mt-0.5">{message.length}/500</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-neutral-600">Send to:</span>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="audience"
              checked={!sellersOnly}
              onChange={() => setSellersOnly(false)}
              className="accent-neutral-900"
            />
            All followers
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="audience"
              checked={sellersOnly}
              onChange={() => setSellersOnly(true)}
              className="accent-neutral-900"
            />
            Sellers only
          </label>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={sending || !message.trim()}
          className="bg-[#2C1F1A] text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-[#3A2A24] disabled:opacity-50 transition-colors"
        >
          {sending ? "Sending…" : "Send Update"}
        </button>
      </form>

      {/* History */}
      {loadingHistory ? (
        <p className="text-sm text-neutral-500">Loading history…</p>
      ) : broadcasts && broadcasts.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-neutral-700">Past updates</h3>
          <ul className="space-y-2">
            {broadcasts.map((b) => (
              <li key={b.id} className="rounded-md border border-neutral-200 p-3 bg-white text-sm">
                <p className="text-neutral-800">{b.message}</p>
                <p className="text-xs text-neutral-500 mt-1">
                  {new Date(b.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  {" · "}
                  {b.recipientCount} recipient{b.recipientCount !== 1 ? "s" : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : broadcasts && broadcasts.length === 0 ? (
        <p className="text-sm text-neutral-500">No updates sent yet.</p>
      ) : null}
    </div>
  );
}
