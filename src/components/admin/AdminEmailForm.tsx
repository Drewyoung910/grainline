"use client";
import { useState } from "react";

export function AdminEmailForm({
  userId,
  userName,
  defaultTo,
  defaultOpen = false,
}: {
  userId?: string;
  userName?: string;
  defaultTo?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [toEmail, setToEmail] = useState(defaultTo ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function handleSend() {
    if (!subject.trim() || !body.trim()) return;
    if (!userId && !toEmail.trim()) return;
    setStatus("sending");
    const payload: Record<string, string> = { subject, body };
    if (userId) {
      payload.userId = userId;
    } else {
      payload.email = toEmail.trim();
    }
    const res = await fetch("/api/admin/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setStatus(res.ok ? "sent" : "error");
    if (res.ok) {
      setSubject("");
      setBody("");
      setTimeout(() => setOpen(false), 1500);
    }
  }

  const label = userName ? `Email ${userName}` : "Send email";

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-blue-600 hover:underline"
      >
        {userId ? "Send email" : label}
      </button>
    );
  }

  return (
    <div className="mt-2 border border-neutral-200 rounded-lg p-3 space-y-2 bg-neutral-50">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-neutral-700">{label}</span>
        <button onClick={() => setOpen(false)} className="text-xs text-neutral-400 hover:text-neutral-600">✕</button>
      </div>
      {!userId && (
        <input
          type="email"
          placeholder="To (email address)"
          value={toEmail}
          onChange={(e) => setToEmail(e.target.value)}
          className="w-full border border-neutral-200 rounded px-2 py-1.5 text-sm"
        />
      )}
      <input
        type="text"
        placeholder="Subject"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        className="w-full border border-neutral-200 rounded px-2 py-1.5 text-sm"
      />
      <textarea
        rows={3}
        placeholder="Message..."
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="w-full border border-neutral-200 rounded px-2 py-1.5 text-sm resize-none"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={handleSend}
          disabled={status === "sending" || !subject.trim() || !body.trim() || (!userId && !toEmail.trim())}
          className="px-3 py-1.5 bg-neutral-900 text-white text-xs rounded hover:bg-neutral-700 disabled:opacity-50"
        >
          {status === "sending" ? "Sending..." : "Send"}
        </button>
        {status === "sent" && <span className="text-xs text-green-600">Sent</span>}
        {status === "error" && <span className="text-xs text-red-600">Failed</span>}
      </div>
    </div>
  );
}
