// src/components/SellerGallery.tsx
"use client";

import { useState, useEffect, useRef } from "react";

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
  const touchStartX = useRef<number>(0);
  const touchEndX = useRef<number>(0);

  useEffect(() => {
    if (!lightboxOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightboxOpen(false);
      if (e.key === "ArrowRight") setLightboxIndex((i) => (i + 1) % allImages.length);
      if (e.key === "ArrowLeft") setLightboxIndex((i) => (i - 1 + allImages.length) % allImages.length);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxOpen, allImages.length]);

  useEffect(() => {
    document.body.style.overflow = lightboxOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [lightboxOpen]);

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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Gallery image ${i + 1}`} className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-black opacity-0 group-hover:opacity-10 transition-opacity pointer-events-none" />
          </button>
        ))}
      </div>

      {lightboxOpen && (
        <div
          className="fixed inset-0 z-[9999] bg-black bg-opacity-90 flex items-center justify-center"
          onClick={() => setLightboxOpen(false)}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <button
            onClick={() => setLightboxOpen(false)}
            className="absolute top-4 right-4 text-white text-2xl font-light hover:text-neutral-300 z-10"
            aria-label="Close"
          >
            ✕
          </button>
          {allImages.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setLightboxIndex((i) => (i - 1 + allImages.length) % allImages.length); }}
                className="absolute left-4 text-white text-3xl hover:text-neutral-300 z-10 px-2"
                aria-label="Previous"
              >‹</button>
              <button
                onClick={(e) => { e.stopPropagation(); setLightboxIndex((i) => (i + 1) % allImages.length); }}
                className="absolute right-16 text-white text-3xl hover:text-neutral-300 z-10 px-2"
                aria-label="Next"
              >›</button>
            </>
          )}
          <div onClick={(e) => e.stopPropagation()} className="max-w-4xl max-h-[85vh] mx-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={allImages[lightboxIndex]}
              alt={`Gallery image ${lightboxIndex + 1}`}
              className="max-w-full max-h-[85vh] object-contain"
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
