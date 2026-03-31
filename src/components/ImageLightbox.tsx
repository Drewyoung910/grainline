// src/components/ImageLightbox.tsx
"use client";
import { useState, useEffect, useRef } from "react";

export function ImageLightbox({ images }: { images: string[] }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const touchStartX = useRef<number>(0);
  const touchEndX = useRef<number>(0);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowRight") setActiveIndex((i) => (i + 1) % images.length);
      if (e.key === "ArrowLeft") setActiveIndex((i) => (i - 1 + images.length) % images.length);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, images.length]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

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
            onClick={() => { setActiveIndex(i); setOpen(true); }}
            className="relative overflow-hidden border border-neutral-200 hover:border-neutral-400 transition-colors"
            style={{ width: 96, height: 96 }}
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
          className="fixed inset-0 z-[9999] bg-black bg-opacity-90 flex items-center justify-center"
          onClick={() => setOpen(false)}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Close button */}
          <button
            onClick={() => setOpen(false)}
            className="absolute top-4 right-4 text-white text-2xl font-light hover:text-neutral-300 z-10"
            aria-label="Close"
          >
            ✕
          </button>

          {/* Prev/Next buttons */}
          {images.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setActiveIndex((i) => (i - 1 + images.length) % images.length); }}
                className="absolute left-4 text-white text-3xl hover:text-neutral-300 z-10 px-2"
                aria-label="Previous image"
              >
                ‹
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setActiveIndex((i) => (i + 1) % images.length); }}
                className="absolute right-16 text-white text-3xl hover:text-neutral-300 z-10 px-2"
                aria-label="Next image"
              >
                ›
              </button>
            </>
          )}

          {/* Main image */}
          <div onClick={(e) => e.stopPropagation()} className="max-w-4xl max-h-[85vh] mx-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={images[activeIndex]}
              alt={`Reference ${activeIndex + 1}`}
              className="max-w-full max-h-[85vh] object-contain"
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
