// src/components/ListingGallery.tsx
"use client";

import { useState, useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import { useBodyScrollLock, useDialogFocus } from "@/lib/dialogFocus";
import { ChevronLeft, ChevronRight } from "@/components/icons";

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
  const mainPhotoRef = useRef<HTMLDivElement>(null);
  // Lightbox swipe
  const touchStartX = useRef<number>(0);
  const touchStartY = useRef<number>(0);
  const touchEndX = useRef<number>(0);
  const lightboxHorizontalLocked = useRef(false);
  // Main photo swipe
  const mainTouchStartX = useRef<number>(0);
  const mainTouchStartY = useRef<number>(0);
  const mainSwiped = useRef(false);
  const mainHorizontalLocked = useRef(false);

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

  useEffect(() => {
    if (photos.length <= 1) return;
    const cleanup = attachHorizontalTouchLock(
      mainPhotoRef,
      mainTouchStartX,
      mainTouchStartY,
      mainHorizontalLocked,
    );
    return cleanup;
  }, [photos.length]);

  useEffect(() => {
    if (!lightboxOpen || photos.length <= 1) return;
    const cleanup = attachHorizontalTouchLock(
      dialogRef,
      touchStartX,
      touchStartY,
      lightboxHorizontalLocked,
    );
    return cleanup;
  }, [lightboxOpen, photos.length]);

  if (photos.length === 0) return null;

  const activeUrl = photos[activeIndex]?.url ?? "";

  function openLightbox(i: number) {
    setLightboxIndex(i);
    setLightboxOpen(true);
  }

  function showPreviousPhoto() {
    setActiveIndex((i) => (i - 1 + photos.length) % photos.length);
  }

  function showNextPhoto() {
    setActiveIndex((i) => (i + 1) % photos.length);
  }

  // Lightbox swipe handlers
  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.targetTouches[0].clientX;
    touchStartY.current = e.targetTouches[0].clientY;
    lightboxHorizontalLocked.current = false;
  }
  function handleTouchEnd(e: React.TouchEvent) {
    touchEndX.current = e.changedTouches[0].clientX;
    const diff = touchStartX.current - touchEndX.current;
    if (Math.abs(diff) > 50) {
      if (diff > 0) setLightboxIndex((i) => (i + 1) % photos.length);
      else setLightboxIndex((i) => (i - 1 + photos.length) % photos.length);
    }
    lightboxHorizontalLocked.current = false;
  }

  // Main photo swipe handlers — swipe changes index; tap (< 10px) opens lightbox
  function handleMainTouchStart(e: React.TouchEvent) {
    mainTouchStartX.current = e.targetTouches[0].clientX;
    mainTouchStartY.current = e.targetTouches[0].clientY;
    mainSwiped.current = false;
    mainHorizontalLocked.current = false;
  }
  function handleMainTouchEnd(e: React.TouchEvent) {
    const diff = mainTouchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) >= 50) {
      mainSwiped.current = true;
      if (diff > 0) setActiveIndex((i) => (i + 1) % photos.length);
      else setActiveIndex((i) => (i - 1 + photos.length) % photos.length);
    }
    mainHorizontalLocked.current = false;
  }

  return (
    <>
      {/* Main photo */}
      <div
        ref={mainPhotoRef}
        role="button"
        tabIndex={0}
        aria-label={`Open ${title} photo gallery`}
        className="relative block w-full touch-pan-y overflow-hidden rounded-lg aspect-[4/5] cursor-zoom-in focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
        onTouchStart={handleMainTouchStart}
        onTouchEnd={handleMainTouchEnd}
        onClick={() => {
          if (mainSwiped.current) { mainSwiped.current = false; return; }
          openLightbox(activeIndex);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openLightbox(activeIndex);
          }
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
        {photos.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              onClick={(event) => {
                event.stopPropagation();
                showPreviousPhoto();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  showPreviousPhoto();
                }
              }}
              className="absolute left-3 top-1/2 z-10 inline-flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white shadow-sm transition hover:bg-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              style={{ borderRadius: "9999px" }}
            >
              <ChevronLeft size={24} />
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={(event) => {
                event.stopPropagation();
                showNextPhoto();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  showNextPhoto();
                }
              }}
              className="absolute right-3 top-1/2 z-10 inline-flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white shadow-sm transition hover:bg-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              style={{ borderRadius: "9999px" }}
            >
              <ChevronRight size={24} />
            </button>
          </>
        )}
        {/* Persistent expand hint — visible on touch + desktop so the
            tap-to-enlarge affordance is discoverable without literal
            "click to enlarge" copy. Top-left so it doesn't collide with
            the favorite heart (top-right). */}
        <div
          className="absolute left-3.5 top-3.5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white shadow-sm backdrop-blur-sm pointer-events-none"
          aria-hidden="true"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
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
          className="fixed inset-0 z-[9999] flex touch-pan-y items-center justify-center bg-black bg-opacity-90"
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

          {photos.length > 1 && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((i) => (i - 1 + photos.length) % photos.length);
                }}
                className="absolute left-[calc(1rem+env(safe-area-inset-left))] z-10 inline-flex min-h-11 min-w-11 items-center justify-center text-white hover:text-neutral-300"
                aria-label="Previous image"
              >
                <ChevronLeft size={28} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((i) => (i + 1) % photos.length);
                }}
                className="absolute right-[calc(1rem+env(safe-area-inset-right))] z-10 inline-flex min-h-11 min-w-11 items-center justify-center text-white hover:text-neutral-300"
                aria-label="Next image"
              >
                <ChevronRight size={28} />
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

function attachHorizontalTouchLock(
  nodeRef: RefObject<HTMLElement | null>,
  startXRef: MutableRefObject<number>,
  startYRef: MutableRefObject<number>,
  horizontalLockedRef: MutableRefObject<boolean>,
) {
  const node = nodeRef.current;
  if (!node) return undefined;

  function handleTouchMove(event: TouchEvent) {
    const touch = event.touches[0];
    if (!touch) return;

    if (horizontalLockedRef.current) {
      if (event.cancelable) event.preventDefault();
      return;
    }

    const dx = Math.abs(touch.clientX - startXRef.current);
    const dy = Math.abs(touch.clientY - startYRef.current);
    if (dx > 10 && dx > dy) {
      horizontalLockedRef.current = true;
      if (event.cancelable) event.preventDefault();
    }
  }

  node.addEventListener("touchmove", handleTouchMove, { passive: false });
  return () => node.removeEventListener("touchmove", handleTouchMove);
}
