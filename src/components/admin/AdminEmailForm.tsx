"use client";
import { useEffect, useId, useRef, useState } from "react";

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
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formId = useId();
  const toEmailId = `${formId}-to-email`;
  const subjectId = `${formId}-subject`;
  const bodyId = `${formId}-body`;

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

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
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(() => {
        setOpen(false);
        closeTimerRef.current = null;
      }, 1500);
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
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close email form"
          className="text-xs text-neutral-500 hover:text-neutral-600"
        >
          ✕
        </button>
      </div>
      {!userId && (
        <div className="space-y-1">
          <label htmlFor={toEmailId} className="sr-only">To email address</label>
          <input
            id={toEmailId}
            type="email"
            placeholder="To (email address)"
            value={toEmail}
            onChange={(e) => setToEmail(e.target.value)}
            className="w-full border border-neutral-200 rounded px-2 py-1.5 text-sm"
          />
        </div>
      )}
      <div className="space-y-1">
        <label htmlFor={subjectId} className="sr-only">Subject</label>
        <input
          id={subjectId}
          type="text"
          placeholder="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="w-full border border-neutral-200 rounded px-2 py-1.5 text-sm"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={bodyId} className="sr-only">Message</label>
        <textarea
          id={bodyId}
          rows={3}
          placeholder="Message..."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="w-full border border-neutral-200 rounded px-2 py-1.5 text-sm resize-none"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSend}
          disabled={status === "sending" || !subject.trim() || !body.trim() || (!userId && !toEmail.trim())}
          className="px-3 py-1.5 bg-neutral-900 text-white text-xs rounded hover:bg-neutral-700 disabled:opacity-50"
        >
          {status === "sending" ? "Sending..." : "Send"}
        </button>
        <span role="status" aria-live="polite" className="text-xs">
          {status === "sent" && <span className="text-green-600">Sent</span>}
          {status === "error" && <span className="text-red-600">Failed</span>}
        </span>
      </div>
    </div>
  );
}
