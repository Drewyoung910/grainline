"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import CommissionRequestForm from "@/components/CommissionRequestForm";
import { X } from "@/components/icons";
import { emitToast } from "@/components/Toast";
import { useBodyScrollLock, useDialogFocus } from "@/lib/dialogFocus";

const DISCARD_PROMPT = "Discard this request? What you typed won't be saved.";

// A real link to the form page, so it works in a new tab, without JavaScript
// and for signed-out visitors, who sign in first. A plain click from a
// signed-in visitor opens the same form in a dialog instead of leaving the page.
export default function CommissionPostButton({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { isLoaded, isSignedIn } = useUser();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const dirtyRef = React.useRef(false);
  const submittingRef = React.useRef(false);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();

  const handleDirtyChange = React.useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);

  const handleSubmittingChange = React.useCallback((submitting: boolean) => {
    submittingRef.current = submitting;
  }, []);

  const requestClose = React.useCallback(() => {
    // Once it's on its way, closing wouldn't stop the request from posting.
    if (submittingRef.current) return;
    if (dirtyRef.current && !window.confirm(DISCARD_PROMPT)) return;
    dirtyRef.current = false;
    setOpen(false);
  }, []);

  useDialogFocus(open, dialogRef, requestClose);
  useBodyScrollLock(open);

  function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    // Let the browser handle new-tab clicks; wait for Clerk rather than guess.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (!isLoaded || !isSignedIn) return;
    event.preventDefault();
    setOpen(true);
  }

  function handlePosted() {
    dirtyRef.current = false;
    submittingRef.current = false;
    setOpen(false);
    emitToast("Your request is posted. Makers who can build it will reach out.", "success");
    if (pathname === "/commission") router.refresh();
    else router.push("/commission");
  }

  return (
    <>
      <Link href="/commission/new" className={className} onClick={handleClick}>
        {children}
      </Link>
      {open && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto overscroll-contain bg-[#14100D]/45 modal-backdrop-in p-4"
          onMouseDown={(event) => {
            // clientWidth stops short of the scrollbar, which also lands here.
            if (event.target === event.currentTarget && event.clientX < event.currentTarget.clientWidth) requestClose();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="my-auto w-full max-w-xl rounded-[20px] bg-[#F7F5F0] p-5 modal-card modal-card-in sm:p-6"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id={titleId} className="font-display text-2xl leading-tight text-neutral-900">Post a commission</h2>
                <p className="mt-1 text-sm text-neutral-500">Makers who can build it reach out, and you pick who to work with.</p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={requestClose}
                className="flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-[#EFEAE0]"
              >
                <X size={18} />
              </button>
            </div>
            <CommissionRequestForm
              onPosted={handlePosted}
              onCancel={requestClose}
              onDirtyChange={handleDirtyChange}
              onSubmittingChange={handleSubmittingChange}
            />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
