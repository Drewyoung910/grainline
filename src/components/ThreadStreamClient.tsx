"use client";

import * as React from "react";

type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  body: string;
  readAt: string | null;
  createdAt: string; // ISO
};

export default function ThreadStreamClient({
  id,
  meId,
  initialMessages,
}: {
  id: string;
  meId: string;
  initialMessages: Message[];
}) {
  const [msgs, setMsgs] = React.useState<Message[]>(initialMessages);
  const bottomRef = React.useRef<HTMLDivElement | null>(null);

  // Scroll to bottom when new messages arrive
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs.length]);

  React.useEffect(() => {
    // Start SSE after the last known message
    const since =
      initialMessages.length > 0
        ? new Date(initialMessages[initialMessages.length - 1].createdAt).getTime()
        : Date.now();

    const es = new EventSource(`/api/messages/${id}/sse?since=${since}`);

    es.onmessage = (ev) => {
      try {
        const incoming = JSON.parse(ev.data) as Message | Message[];
        const batch = Array.isArray(incoming) ? incoming : [incoming];
        if (batch.length === 0) return;
        // de-dupe by id
        setMsgs((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const next = [...prev];
          for (const m of batch) if (!seen.has(m.id)) next.push(m);
          return next;
        });
      } catch {}
    };

    es.onerror = () => {
      // Close; EventSource will not auto-retry forever in some browsers.
      // You could add a backoff/reconnect if you like.
      es.close();
    };

    return () => es.close();
  }, [id]); // only on mount/unmount for this convo

  return (
    <section className="card-section p-4">
      <ul className="space-y-3">
        {msgs.map((m) => {
          const mine = m.senderId === meId;
          return (
            <li key={m.id} className={`max-w-[80%] ${mine ? "ml-auto text-right" : ""}`}>
              <div className={`inline-block rounded-2xl px-3 py-2 ${mine ? "bg-black text-white" : "bg-neutral-100"}`}>
                <div className="whitespace-pre-wrap break-words">{m.body}</div>
              </div>
              <div className="mt-1 text-[11px] text-neutral-500">
                {new Date(m.createdAt).toLocaleString()}
              </div>
            </li>
          );
        })}
      </ul>
      <div ref={bottomRef} />
    </section>
  );
}
