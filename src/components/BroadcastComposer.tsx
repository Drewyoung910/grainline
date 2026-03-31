"use client";

import * as React from "react";

type Broadcast = {
  id: string;
  message: string;
  imageUrl: string | null;
  sentAt: string;
  recipientCount: number;
};

export default function BroadcastComposer({ followerCount }: { followerCount: number }) {
  const [message, setMessage] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sellersOnly, setSellersOnly] = React.useState(false);
  const [broadcasts, setBroadcasts] = React.useState<Broadcast[] | null>(null);
  const [loadingHistory, setLoadingHistory] = React.useState(false);

  React.useEffect(() => {
    setLoadingHistory(true);
    fetch("/api/seller/broadcast")
      .then((r) => r.json())
      .then((data: { broadcasts: Broadcast[] }) => setBroadcasts(data.broadcasts ?? []))
      .catch(() => setBroadcasts([]))
      .finally(() => setLoadingHistory(false));
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
        const data = await res.json() as { error?: string };
        setError(data.error ?? "Failed to send");
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
            <span className="ml-2 text-neutral-400 font-normal">({followerCount} follower{followerCount !== 1 ? "s" : ""})</span>
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={500}
            rows={4}
            placeholder="Share a shop update, new project, or announcement…"
            className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <p className="text-xs text-neutral-400 text-right mt-0.5">{message.length}/500</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-neutral-600">Send to:</span>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="audience"
              checked={!sellersOnly}
              onChange={() => setSellersOnly(false)}
              className="accent-amber-600"
            />
            All followers
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="audience"
              checked={sellersOnly}
              onChange={() => setSellersOnly(true)}
              className="accent-amber-600"
            />
            Sellers only
          </label>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={sending || !message.trim()}
          className="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors"
        >
          {sending ? "Sending…" : "Send Update"}
        </button>
      </form>

      {/* History */}
      {loadingHistory ? (
        <p className="text-sm text-neutral-400">Loading history…</p>
      ) : broadcasts && broadcasts.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-neutral-700">Past updates</h3>
          <ul className="space-y-2">
            {broadcasts.map((b) => (
              <li key={b.id} className="rounded-lg border p-3 bg-stone-50 text-sm">
                <p className="text-neutral-800">{b.message}</p>
                <p className="text-xs text-neutral-400 mt-1">
                  {new Date(b.sentAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  {" · "}
                  {b.recipientCount} recipient{b.recipientCount !== 1 ? "s" : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : broadcasts && broadcasts.length === 0 ? (
        <p className="text-sm text-neutral-400">No updates sent yet.</p>
      ) : null}
    </div>
  );
}
