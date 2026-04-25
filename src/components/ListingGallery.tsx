// src/components/ListingGallery.tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { useBodyScrollLock, useDialogFocus } from "@/lib/dialogFocus";

type Photo = { id: string; url: string; altText?: string | null };

export default function ListingGallery({
  photos,
  title,
}: {
  photos: Photo[];
  title: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Lightbox swipe
  const touchStartX = useRef<number>(0);
  const touchEndX = useRef<number>(0);
  // Main photo swipe
  const mainTouchStartX = useRef<number>(0);
  const mainSwiped = useRef(false);

  useDialogFocus(lightboxOpen, dialogRef, () => setLightboxOpen(false));
  useBodyScrollLock(lightboxOpen);

  useEffect(() => {
    if (!lightboxOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") setLightboxIndex((i) => (i + 1) % photos.length);
      if (e.key === "ArrowLeft") setLightboxIndex((i) => (i - 1 + photos.length) % photos.length);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxOpen, photos.length]);

  if (photos.length === 0) return null;

  const activeUrl = photos[activeIndex]?.url ?? "";

  function openLightbox(i: number) {
    setLightboxIndex(i);
    setLightboxOpen(true);
  }

  // Lightbox swipe handlers
  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.targetTouches[0].clientX;
  }
  function handleTouchEnd(e: React.TouchEvent) {
    touchEndX.current = e.changedTouches[0].clientX;
    const diff = touchStartX.current - touchEndX.current;
    if (Math.abs(diff) > 50) {
      if (diff > 0) setLightboxIndex((i) => (i + 1) % photos.length);
      else setLightboxIndex((i) => (i - 1 + photos.length) % photos.length);
    }
  }

  // Main photo swipe handlers — swipe changes index; tap (< 10px) opens lightbox
  function handleMainTouchStart(e: React.TouchEvent) {
    mainTouchStartX.current = e.targetTouches[0].clientX;
    mainSwiped.current = false;
  }
  function handleMainTouchEnd(e: React.TouchEvent) {
    const diff = mainTouchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) >= 50) {
      mainSwiped.current = true;
      if (diff > 0) setActiveIndex((i) => (i + 1) % photos.length);
      else setActiveIndex((i) => (i - 1 + photos.length) % photos.length);
    }
  }

  return (
    <>
      {/* Main photo */}
      <div
        className="relative w-full rounded-lg overflow-hidden cursor-zoom-in h-[350px] sm:h-[400px] md:h-[500px]"
        onTouchStart={handleMainTouchStart}
        onTouchEnd={handleMainTouchEnd}
        onClick={() => {
          if (mainSwiped.current) { mainSwiped.current = false; return; }
          openLightbox(activeIndex);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={activeUrl}
          alt={photos[activeIndex]?.altText ?? title}
          fetchPriority="high"
          className="w-full h-full object-cover"
        />
        {photos.length > 1 && (
          <div className="absolute bottom-3 right-3 bg-black bg-opacity-60 text-white text-xs px-2 py-1 rounded-full pointer-events-none">
            {activeIndex + 1} / {photos.length}
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity pointer-events-none">
          <div className="bg-black bg-opacity-30 rounded-full p-2">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
            </svg>
          </div>
        </div>
      </div>

      {/* Thumbnails */}
      {photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto mt-2 pb-1">
          {photos.map((p, i) => (
            <button
              key={p.id}
              onClick={() => setActiveIndex(i)}
              className={`shrink-0 w-16 h-16 rounded-md overflow-hidden border-2 transition-colors ${
                i === activeIndex
                  ? "border-neutral-900"
                  : "border-neutral-200 hover:border-neutral-400"
              }`}
              aria-label={`View photo ${i + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.altText ?? `${title} — photo ${i + 1}`} className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* Lightbox */}
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
            className="absolute top-4 right-4 text-white text-2xl font-light hover:text-neutral-300 z-10"
            aria-label="Close"
          >
            ✕
          </button>

          {photos.length > 1 && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((i) => (i - 1 + photos.length) % photos.length);
                }}
                className="absolute left-4 text-white text-3xl hover:text-neutral-300 z-10 px-2"
                aria-label="Previous image"
              >
                ‹
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((i) => (i + 1) % photos.length);
                }}
                className="absolute right-16 text-white text-3xl hover:text-neutral-300 z-10 px-2"
                aria-label="Next image"
              >
                ›
              </button>
            </>
          )}

          <div onClick={(e) => e.stopPropagation()} className="max-w-4xl max-h-[85vh] mx-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photos[lightboxIndex]?.url}
              alt={photos[lightboxIndex]?.altText ?? `${title} — photo ${lightboxIndex + 1}`}
              className="max-w-full max-h-[85vh] object-contain"
            />
            {photos.length > 1 && (
              <p className="text-center text-white text-sm mt-2 opacity-60">
                {lightboxIndex + 1} / {photos.length}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
