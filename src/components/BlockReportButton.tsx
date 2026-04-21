"use client";
import { useState, useRef } from "react";

type Props = {
  targetUserId: string;
  targetName: string;
  initialBlocked?: boolean;
  targetType?: string;
  targetId?: string;
};

const REPORT_REASONS = [
  { value: "SPAM", label: "Spam" },
  { value: "HARASSMENT", label: "Harassment" },
  { value: "FAKE_LISTING", label: "Fake listing" },
  { value: "INAPPROPRIATE", label: "Inappropriate content" },
  { value: "OTHER", label: "Other" },
];

export default function BlockReportButton({ targetUserId, targetName, initialBlocked = false, targetType, targetId }: Props) {
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const [view, setView] = useState<"menu" | "report">("menu");
  const [blocked, setBlocked] = useState(initialBlocked);
  const [reportReason, setReportReason] = useState("SPAM");
  const [reportDetails, setReportDetails] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const triggerRef = useRef<HTMLButtonElement>(null);

  function handleOpen() {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setOpenUpward(rect.bottom > window.innerHeight - 200);
    }
    setOpen(true);
  }

  async function handleBlock() {
    setStatus("loading");
    const method = blocked ? "DELETE" : "POST";
    const res = await fetch(`/api/users/${targetUserId}/block`, { method });
    if (res.ok) setBlocked(!blocked);
    setStatus("idle");
    setOpen(false);
  }

  async function handleReport() {
    setStatus("loading");
    const res = await fetch(`/api/users/${targetUserId}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reportReason, details: reportDetails || undefined, ...(targetType ? { targetType } : {}), ...(targetId ? { targetId } : {}) }),
    });
    setStatus(res.ok ? "done" : "idle");
    if (res.ok) setTimeout(() => { setOpen(false); setView("menu"); setStatus("idle"); }, 1500);
  }

  const reportLabel =
    targetType === "LISTING" ? "Report this listing"
    : targetType === "MESSAGE_THREAD" ? "Report this conversation"
    : targetType === "REVIEW" ? "Report this review"
    : targetType === "BLOG_COMMENT" ? "Report this comment"
    : `Report ${targetName}`;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={open ? () => { setOpen(false); setView("menu"); } : handleOpen}
        className="text-xs text-neutral-400 hover:text-neutral-600 px-2 py-1 rounded"
        aria-label="More options"
      >
        •••
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setView("menu"); }} />
          <div className={`absolute right-0 z-50 bg-white border border-neutral-200 rounded-lg shadow-lg w-48 py-1 ${openUpward ? "bottom-full mb-1" : "top-full mt-1"}`}>
            {view === "menu" ? (
              <>
                <button
                  onClick={handleBlock}
                  disabled={status === "loading"}
                  className="w-full text-left px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
                >
                  {blocked ? `Unblock ${targetName}` : `Block ${targetName}`}
                </button>
                <button
                  onClick={() => setView("report")}
                  className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-neutral-50"
                >
                  {reportLabel}
                </button>
              </>
            ) : status === "done" ? (
              <div className="px-4 py-3 text-sm text-green-600">Report submitted ✓</div>
            ) : (
              <div className="p-3 space-y-2">
                <p className="text-xs font-medium text-neutral-700">Why are you reporting?</p>
                <select
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  className="w-full border border-neutral-200 rounded px-2 py-1 text-xs"
                >
                  {REPORT_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
                <textarea
                  rows={2}
                  placeholder="Additional details (optional)"
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                  className="w-full border border-neutral-200 rounded px-2 py-1 text-xs resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleReport}
                    disabled={status === "loading"}
                    className="flex-1 bg-red-600 text-white text-xs py-1.5 rounded hover:bg-red-700 disabled:opacity-50"
                  >
                    {status === "loading" ? "Submitting…" : "Submit"}
                  </button>
                  <button
                    onClick={() => setView("menu")}
                    className="flex-1 border border-neutral-200 text-xs py-1.5 rounded hover:bg-neutral-50"
                  >
                    Back
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
