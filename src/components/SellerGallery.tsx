// src/components/SellerGallery.tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { useBodyScrollLock, useDialogFocus } from "@/lib/dialogFocus";
import MediaImage from "@/components/MediaImage";

export default function SellerGallery({
  workshopImageUrl,
  images = [],
}: {
  workshopImageUrl?: string | null;
  images?: string[];
}) {
  const allImages = [
    ...(workshopImageUrl ? [workshopImageUrl] : []),
    ...images,
  ].filter(Boolean) as string[];

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number>(0);
  const touchEndX = useRef<number>(0);

  useDialogFocus(lightboxOpen, dialogRef, () => setLightboxOpen(false));
  useBodyScrollLock(lightboxOpen);

  useEffect(() => {
    if (!lightboxOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") setLightboxIndex((i) => (i + 1) % allImages.length);
      if (e.key === "ArrowLeft") setLightboxIndex((i) => (i - 1 + allImages.length) % allImages.length);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxOpen, allImages.length]);

  if (allImages.length === 0) return null;

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.targetTouches[0].clientX;
  }
  function handleTouchEnd(e: React.TouchEvent) {
    touchEndX.current = e.changedTouches[0].clientX;
    const diff = touchStartX.current - touchEndX.current;
    if (Math.abs(diff) > 50) {
      if (diff > 0) setLightboxIndex((i) => (i + 1) % allImages.length);
      else setLightboxIndex((i) => (i - 1 + allImages.length) % allImages.length);
    }
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {allImages.map((url, i) => (
          <button
            key={url}
            onClick={() => { setLightboxIndex(i); setLightboxOpen(true); }}
            className="relative h-40 w-full overflow-hidden border hover:border-neutral-400 transition-colors group"
            aria-label={`View gallery image ${i + 1}`}
          >
            <MediaImage
              src={url}
              alt={`Gallery image ${i + 1}`}
              className="h-full w-full object-cover"
              fallbackClassName="h-full w-full bg-gradient-to-br from-amber-50 to-stone-100"
            />
            <div className="absolute inset-0 bg-black opacity-0 group-hover:opacity-10 transition-opacity pointer-events-none" />
          </button>
        ))}
      </div>

      {lightboxOpen && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Image lightbox"
          tabIndex={-1}
          className="fixed inset-0 z-[9999] bg-black bg-opacity-90 flex items-center justify-center"
          onClick={() => setLightboxOpen(false)}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <button
            onClick={() => setLightboxOpen(false)}
            className="absolute right-[calc(1rem+env(safe-area-inset-right))] top-[calc(1rem+env(safe-area-inset-top))] z-10 inline-flex min-h-11 min-w-11 items-center justify-center text-2xl font-light text-white hover:text-neutral-300"
            aria-label="Close"
          >
            ✕
          </button>
          {allImages.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setLightboxIndex((i) => (i - 1 + allImages.length) % allImages.length); }}
                className="absolute left-[calc(1rem+env(safe-area-inset-left))] z-10 inline-flex min-h-11 min-w-11 items-center justify-center text-3xl text-white hover:text-neutral-300"
                aria-label="Previous"
              >‹</button>
              <button
                onClick={(e) => { e.stopPropagation(); setLightboxIndex((i) => (i + 1) % allImages.length); }}
                className="absolute right-[calc(1rem+env(safe-area-inset-right))] z-10 inline-flex min-h-11 min-w-11 items-center justify-center text-3xl text-white hover:text-neutral-300"
                aria-label="Next"
              >›</button>
            </>
          )}
          <div onClick={(e) => e.stopPropagation()} className="max-w-4xl max-h-[85vh] mx-4">
            <MediaImage
              src={allImages[lightboxIndex]}
              alt={`Gallery image ${lightboxIndex + 1}`}
              className="max-w-full max-h-[85vh] object-contain"
              fallbackClassName="h-[60vh] w-[80vw] max-w-full bg-neutral-900"
            />
            {allImages.length > 1 && (
              <p className="text-center text-white text-sm mt-2 opacity-60">
                {lightboxIndex + 1} / {allImages.length}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
