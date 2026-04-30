// src/components/CoverLightbox.tsx
"use client";

import { useRef, useState } from "react";
import { useBodyScrollLock, useDialogFocus } from "@/lib/dialogFocus";

export default function CoverLightbox({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useDialogFocus(open, dialogRef, () => setOpen(false));
  useBodyScrollLock(open);

  if (failed) {
    return (
      <div
        aria-hidden="true"
        className={`${className ?? "w-full h-64"} bg-gradient-to-br from-amber-50 to-stone-100`}
      />
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="block w-full cursor-zoom-in"
        aria-label="Expand image"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />
      </button>

      {open && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Image lightbox"
          tabIndex={-1}
          className="fixed inset-0 z-[9999] bg-black bg-opacity-90 flex items-center justify-center"
          onClick={() => setOpen(false)}
        >
          <button
            onClick={() => setOpen(false)}
            className="absolute right-[calc(1rem+env(safe-area-inset-right))] top-[calc(1rem+env(safe-area-inset-top))] z-10 inline-flex min-h-11 min-w-11 items-center justify-center text-2xl font-light text-white hover:text-neutral-300"
            aria-label="Close"
          >
            ✕
          </button>
          <div onClick={(e) => e.stopPropagation()} className="max-w-5xl max-h-[90vh] mx-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt} className="max-w-full max-h-[90vh] object-contain" onError={() => setFailed(true)} />
          </div>
        </div>
      )}
    </>
  );
}
