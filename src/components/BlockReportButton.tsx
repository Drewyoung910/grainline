"use client";
import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { readApiErrorMessage } from "@/lib/apiError";
import { useToast } from "@/components/Toast";

type Props = {
  targetUserId: string;
  targetName: string;
  initialBlocked?: boolean;
  targetType?: string;
  targetId?: string;
  /** Where to send the user after a successful BLOCK (not unblock). Use on
   * pages that become inaccessible once the target is blocked (seller
   * profile, listing detail). Defaults to refreshing the current route. */
  afterBlockHref?: string;
};

const REPORT_REASONS = [
  { value: "SPAM", label: "Spam" },
  { value: "HARASSMENT", label: "Harassment" },
  { value: "FAKE_LISTING", label: "Fake listing" },
  { value: "INAPPROPRIATE", label: "Inappropriate content" },
  { value: "OTHER", label: "Other" },
];

const MENU_WIDTH = 224; // matches w-56
const MENU_MARGIN = 8;

export default function BlockReportButton({ targetUserId, targetName, initialBlocked = false, targetType, targetId, afterBlockHref }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"menu" | "report">("menu");
  const [blocked, setBlocked] = useState(initialBlocked);
  const [reportReason, setReportReason] = useState("SPAM");
  const [reportDetails, setReportDetails] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Position the menu relative to the trigger but clamped inside the
  // viewport so it never gets cut off (especially on mobile where the
  // trigger sits at the right edge of a parent container).
  function recomputeMenuPos() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportW = window.innerWidth;
    // Prefer right-aligning under the trigger, then clamp to viewport.
    let left = rect.right - MENU_WIDTH;
    left = Math.max(MENU_MARGIN, Math.min(left, viewportW - MENU_WIDTH - MENU_MARGIN));
    const top = rect.bottom + MENU_MARGIN;
    setMenuPos({ top, left });
  }

  function handleOpen() {
    setError(null);
    recomputeMenuPos();
    setOpen(true);
  }

  // Reposition on scroll/resize while open.
  useEffect(() => {
    if (!open) return;
    const onWindow = () => recomputeMenuPos();
    window.addEventListener("scroll", onWindow, { passive: true, capture: true });
    window.addEventListener("resize", onWindow);
    return () => {
      window.removeEventListener("scroll", onWindow, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", onWindow);
    };
  }, [open]);

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
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Could not update block settings."));
      const nowBlocked = !blocked;
      setBlocked(nowBlocked);
      setStatus("idle");
      setOpen(false);
      setView("menu");
      toast(nowBlocked ? `Blocked ${targetName}` : `Unblocked ${targetName}`, "success");
      // Refresh so the page immediately reflects the block (hidden content,
      // disabled composer, etc.). On pages that 404 once blocked, navigate
      // away instead of stranding the user.
      if (nowBlocked && afterBlockHref) {
        router.push(afterBlockHref);
      } else {
        router.refresh();
      }
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
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Could not submit report."));
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
    <>
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

      {open && mounted && createPortal(
        <>
          <div
            className="fixed inset-0 z-[9998]"
            onClick={() => { setOpen(false); setView("menu"); }}
          />
          <div
            role="menu"
            style={{
              position: "fixed",
              top: menuPos?.top ?? 0,
              left: menuPos?.left ?? 0,
              width: MENU_WIDTH,
              maxHeight: `calc(100vh - ${(menuPos?.top ?? 0) + MENU_MARGIN}px)`,
              transform: menuPos ? undefined : "translate(-200vw,-200vw)",
            }}
            className="z-[9999] bg-white border border-neutral-200 rounded-lg shadow-lg py-1 overflow-y-auto"
          >
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
                <label htmlFor="report-reason" className="text-xs font-medium text-neutral-700">Why are you reporting?</label>
                <select
                  id="report-reason"
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  className="w-full border border-neutral-200 rounded px-2 py-1 text-xs"
                >
                  {REPORT_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
                <label htmlFor="report-details" className="sr-only">Additional report details</label>
                <textarea
                  id="report-details"
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
        </>,
        document.body,
      )}
    </>
  );
}
