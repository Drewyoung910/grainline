"use client";
import { useEffect, useState, useRef } from "react";

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
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  async function readApiError(res: Response, fallback: string) {
    const data = await res.json().catch(() => null) as { error?: string } | null;
    return data?.error || fallback;
  }

  function handleOpen() {
    setError(null);
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setOpenUpward(rect.bottom > window.innerHeight - 200);
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setView("menu");
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function handleBlock() {
    setStatus("loading");
    setError(null);
    const method = blocked ? "DELETE" : "POST";
    try {
      const res = await fetch(`/api/users/${targetUserId}/block`, { method });
      if (!res.ok) throw new Error(await readApiError(res, "Could not update block settings."));
      setBlocked(!blocked);
      setStatus("idle");
      setOpen(false);
    } catch (e) {
      setStatus("idle");
      setError(e instanceof Error ? e.message : "Could not update block settings.");
    }
  }

  async function handleReport() {
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch(`/api/users/${targetUserId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reportReason, details: reportDetails || undefined, ...(targetType ? { targetType } : {}), ...(targetId ? { targetId } : {}) }),
      });
      if (!res.ok) throw new Error(await readApiError(res, "Could not submit report."));
      setStatus("done");
      setTimeout(() => { setOpen(false); setView("menu"); setStatus("idle"); }, 1500);
    } catch (e) {
      setStatus("idle");
      setError(e instanceof Error ? e.message : "Could not submit report.");
    }
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
        className="text-xs text-neutral-500 hover:text-neutral-600 px-2 py-1 rounded"
        aria-label="More options"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        •••
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setView("menu"); }} />
          <div role="menu" className={`absolute right-0 z-50 bg-white border border-neutral-200 rounded-lg shadow-lg w-48 py-1 ${openUpward ? "bottom-full mb-1" : "top-full mt-1"}`}>
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
                {error && (
                  <p className="px-4 py-2 text-xs text-red-600" role="alert">{error}</p>
                )}
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
                {error && (
                  <p className="text-xs text-red-600" role="alert">{error}</p>
                )}
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
