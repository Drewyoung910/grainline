// src/components/ImageLightbox.tsx
"use client";
import { useState, useEffect, useRef } from "react";
import { useBodyScrollLock, useDialogFocus } from "@/lib/dialogFocus";
import { usePhotoViewerMotion } from "@/lib/usePhotoViewerMotion";

export function ImageLightbox({ images, thumbnailSize = 96 }: { images: string[]; thumbnailSize?: number }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number>(0);
  const touchEndX = useRef<number>(0);

  const photoRef = useRef<HTMLImageElement>(null);
  const thumbnailsRef = useRef(new Map<number, HTMLElement>());
  const { closeViewer } = usePhotoViewerMotion({
    open,
    photoRef,
    dialogRef,
    getSource: () => thumbnailsRef.current.get(activeIndex) ?? null,
    onClosed: () => setOpen(false),
  });
  useDialogFocus(open, dialogRef, closeViewer);
  useBodyScrollLock(open);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === "ArrowRight") setActiveIndex((i) => (i + 1) % images.length);
      if (e.key === "ArrowLeft") setActiveIndex((i) => (i - 1 + images.length) % images.length);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, images.length]);

  if (images.length === 0) return null;

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.targetTouches[0].clientX;
  }
  function handleTouchEnd(e: React.TouchEvent) {
    touchEndX.current = e.changedTouches[0].clientX;
    const diff = touchStartX.current - touchEndX.current;
    if (Math.abs(diff) > 50) {
      if (diff > 0) setActiveIndex((i) => (i + 1) % images.length);
      else setActiveIndex((i) => (i - 1 + images.length) % images.length);
    }
  }

  return (
    <>
      {/* Thumbnail grid */}
      <div className="flex gap-2 flex-wrap">
        {images.map((url, i) => (
          <button
            key={i}
            ref={(element) => {
              if (element) thumbnailsRef.current.set(i, element);
              else thumbnailsRef.current.delete(i);
            }}
            onClick={() => { setActiveIndex(i); setOpen(true); }}
            className="relative overflow-hidden border border-neutral-200 hover:border-neutral-400 transition-colors"
            style={{ width: thumbnailSize, height: thumbnailSize }}
            aria-label={`View reference image ${i + 1}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Reference ${i + 1}`} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black opacity-0 hover:opacity-10 transition-opacity" />
          </button>
        ))}
      </div>

      {/* Lightbox modal */}
      {open && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Image lightbox"
          tabIndex={-1}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90"
          onClick={closeViewer}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Close button */}
          <button
            onClick={closeViewer}
            className="absolute right-[calc(1rem+env(safe-area-inset-right))] top-[calc(1rem+env(safe-area-inset-top))] z-10 inline-flex min-h-11 min-w-11 items-center justify-center border-0 bg-transparent text-2xl font-light text-white shadow-none outline-none ring-0 hover:text-neutral-300 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            aria-label="Close"
          >
            <span aria-hidden="true">✕</span>
          </button>

          {/* Prev/Next buttons */}
          {images.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setActiveIndex((i) => (i - 1 + images.length) % images.length); }}
                className="absolute left-[calc(1rem+env(safe-area-inset-left))] z-10 inline-flex min-h-11 min-w-11 items-center justify-center text-3xl text-white hover:text-neutral-300"
                aria-label="Previous image"
              >
                ‹
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setActiveIndex((i) => (i + 1) % images.length); }}
                className="absolute right-[calc(1rem+env(safe-area-inset-right))] z-10 inline-flex min-h-11 min-w-11 items-center justify-center text-3xl text-white hover:text-neutral-300"
                aria-label="Next image"
              >
                ›
              </button>
            </>
          )}

          {/* Main image */}
          <div onClick={(e) => e.stopPropagation()} className="max-w-4xl max-h-[85dvh] mx-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={photoRef}
              src={images[activeIndex]}
              alt={`Reference ${activeIndex + 1}`}
              className="max-w-full max-h-[85dvh] object-contain"
            />
            {images.length > 1 && (
              <p className="text-center text-white text-sm mt-2 opacity-60">
                {activeIndex + 1} / {images.length}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
