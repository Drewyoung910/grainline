// src/components/ListingGallery.tsx
"use client";

import { useState, useEffect, useLayoutEffect, useRef, type MutableRefObject, type RefObject } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import { isPageZoomed, useBodyScrollLock, useDialogFocus } from "@/lib/dialogFocus";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { isFirstPartyMediaUrl } from "@/lib/urlValidation";
import { LISTING_GALLERY_FRAME_HEIGHT, LISTING_PHOTO_TARGET_ATTRIBUTE } from "@/lib/photoMotion";
import { usePhotoViewerMotion } from "@/lib/usePhotoViewerMotion";

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
  const [optimizerFailures, setOptimizerFailures] = useState<ReadonlySet<string>>(() => new Set());
  const dialogRef = useRef<HTMLDivElement>(null);
  const mainPhotoRef = useRef<HTMLDivElement>(null);
  const thumbnailListRef = useRef<HTMLDivElement>(null);
  const thumbnailRefs = useRef(new Map<number, HTMLButtonElement>());
  const [thumbnailIndicator, setThumbnailIndicator] = useState<{ left: number; width: number } | null>(null);
  // Set when the viewer moves to another photo, so only that photo's load gets
  // the short cross-fade (never the first photo shown).
  const mainSwapRef = useRef(false);
  const lightboxSwapRef = useRef(false);
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

  const lightboxPhotoRef = useRef<HTMLImageElement>(null);
  const { closeViewer } = usePhotoViewerMotion({
    open: lightboxOpen,
    photoRef: lightboxPhotoRef,
    dialogRef,
    getSource: () => mainPhotoRef.current,
    onClosed: () => {
      // The page keeps the photo the visitor stopped on.
      setActiveIndex(lightboxIndex);
      setLightboxOpen(false);
    },
  });
  useDialogFocus(lightboxOpen, dialogRef, closeViewer);
  useBodyScrollLock(lightboxOpen);

  useEffect(() => {
    if (!lightboxOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") {
        lightboxSwapRef.current = true;
        setLightboxIndex((i) => (i + 1) % photos.length);
      }
      if (e.key === "ArrowLeft") {
        lightboxSwapRef.current = true;
        setLightboxIndex((i) => (i - 1 + photos.length) % photos.length);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxOpen, photos.length]);

  // The selected thumbnail outline glides to the next photo rather than
  // disappearing from one button and popping onto another.
  useLayoutEffect(() => {
    const list = thumbnailListRef.current;
    const selected = thumbnailRefs.current.get(activeIndex);
    if (!list || !selected) return;

    const measure = () => {
      const next = thumbnailRefs.current.get(activeIndex);
      if (!next) return;
      setThumbnailIndicator({ left: next.offsetLeft, width: next.offsetWidth });
      const nextEnd = next.offsetLeft + next.offsetWidth;
      if (next.offsetLeft < list.scrollLeft || nextEnd > list.scrollLeft + list.clientWidth) {
        list.scrollTo({ left: Math.max(0, next.offsetLeft - 8), behavior: "smooth" });
      }
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [activeIndex, photos.length]);

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

  // Behind the viewer the page follows along, so the photo it shrinks back into
  // has already loaded instead of swapping in afterwards.
  const mainIndex = lightboxOpen ? lightboxIndex : activeIndex;
  const activeUrl = photos[mainIndex]?.url ?? "";

  function openLightbox(i: number) {
    lightboxSwapRef.current = false;
    setLightboxIndex(i);
    setLightboxOpen(true);
  }

  function showPhoto(i: number) {
    if (i === activeIndex) return;
    mainSwapRef.current = true;
    setActiveIndex(i);
  }

  function showPreviousPhoto() {
    mainSwapRef.current = true;
    setActiveIndex((i) => (i - 1 + photos.length) % photos.length);
  }

  function showNextPhoto() {
    mainSwapRef.current = true;
    setActiveIndex((i) => (i + 1) % photos.length);
  }

  function showPreviousLightboxPhoto() {
    lightboxSwapRef.current = true;
    setLightboxIndex((i) => (i - 1 + photos.length) % photos.length);
  }

  function showNextLightboxPhoto() {
    lightboxSwapRef.current = true;
    setLightboxIndex((i) => (i + 1) % photos.length);
  }

  // Lightbox swipe handlers
  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.targetTouches[0].clientX;
    touchStartY.current = e.targetTouches[0].clientY;
    lightboxHorizontalLocked.current = false;
  }
  function handleTouchEnd(e: React.TouchEvent) {
    lightboxHorizontalLocked.current = false;
    if (e.touches.length > 0 || isPageZoomed()) return;
    touchEndX.current = e.changedTouches[0].clientX;
    const diff = touchStartX.current - touchEndX.current;
    if (Math.abs(diff) > 50) {
      if (diff > 0) showNextLightboxPhoto();
      else showPreviousLightboxPhoto();
    }
  }

  // Main photo swipe handlers — swipe changes index; tap (< 10px) opens lightbox
  function handleMainTouchStart(e: React.TouchEvent) {
    mainTouchStartX.current = e.targetTouches[0].clientX;
    mainTouchStartY.current = e.targetTouches[0].clientY;
    mainSwiped.current = false;
    mainHorizontalLocked.current = false;
  }
  function handleMainTouchEnd(e: React.TouchEvent) {
    mainHorizontalLocked.current = false;
    if (e.touches.length > 0 || isPageZoomed()) return;
    const diff = mainTouchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) >= 50) {
      mainSwiped.current = true;
      if (diff > 0) showNextPhoto();
      else showPreviousPhoto();
    }
  }

  return (
    <>
      {/* Main photo */}
      <div
        ref={mainPhotoRef}
        {...{ [LISTING_PHOTO_TARGET_ATTRIBUTE]: "" }}
        role="button"
        tabIndex={0}
        aria-label={`Open ${title} photo gallery`}
        className={`group/gallery relative isolate block ${LISTING_GALLERY_FRAME_HEIGHT} w-full touch-pan-y touch-pinch-zoom overflow-hidden rounded-lg bg-[#EFEAE0] cursor-zoom-in focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900`}
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
        <Image
          src={activeUrl}
          alt={photos[mainIndex]?.altText ?? title}
          unoptimized={!isFirstPartyMediaUrl(activeUrl) || optimizerFailures.has(activeUrl)}
          fill
          sizes="(max-width: 1023px) 100vw, 50vw"
          preload={mainIndex === 0}
          data-fly-to-cart-source=""
          className="h-full w-full object-contain"
          onLoad={(e) => {
            if (!mainSwapRef.current) return;
            mainSwapRef.current = false;
            playPhotoSwap(e.currentTarget);
          }}
          onError={() => {
            if (!isFirstPartyMediaUrl(activeUrl) || optimizerFailures.has(activeUrl)) return;
            setOptimizerFailures((current) => new Set(current).add(activeUrl));
          }}
        />
        {photos.length > 1 && (
          <div className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-black/60 px-2 py-1 text-xs text-white">
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
              className="absolute left-3 top-1/2 z-10 hidden min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-neutral-900 opacity-0 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.55)] transition-[opacity,background-color,scale] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] hover:bg-white focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 lg:inline-flex lg:group-hover/gallery:opacity-100"
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
              className="absolute right-3 top-1/2 z-10 hidden min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-neutral-900 opacity-0 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.55)] transition-[opacity,background-color,scale] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] hover:bg-white focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 lg:inline-flex lg:group-hover/gallery:opacity-100"
              style={{ borderRadius: "9999px" }}
            >
              <ChevronRight size={24} />
            </button>
          </>
        )}
        {/* Expand and favorite use the same 44px corner cell and 36px visible
            circle, so the gallery controls are optically symmetrical. */}
        <div
          className="pointer-events-none absolute left-0 top-0 inline-flex h-11 w-11 items-center justify-center"
          aria-hidden="true"
        >
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white shadow-sm backdrop-blur-sm">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            </svg>
          </span>
        </div>
      </div>

      {/* Thumbnails */}
      {photos.length > 1 && (
        <div ref={thumbnailListRef} className="scrollbar-hidden relative mt-2 flex gap-2 overflow-x-auto pb-1">
          {thumbnailIndicator && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-0 top-0 z-10 h-16 rounded-md border-2 border-neutral-900 transition-[translate,width] duration-[360ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none"
              style={{ width: thumbnailIndicator.width, translate: `${thumbnailIndicator.left}px 0` }}
            />
          )}
          {photos.map((p, i) => (
            <button
              key={p.id}
              ref={(element) => {
                if (element) thumbnailRefs.current.set(i, element);
                else thumbnailRefs.current.delete(i);
              }}
              onClick={() => showPhoto(i)}
              aria-current={i === activeIndex ? "true" : undefined}
              className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-md border transition-colors ${
                i === activeIndex && !thumbnailIndicator
                  ? "border-neutral-900"
                  : "border-neutral-200 hover:border-neutral-400"
              }`}
              aria-label={`View photo ${i + 1}`}
            >
              <Image
                src={p.url}
                alt={p.altText ?? `${title} — photo ${i + 1}`}
                unoptimized={!isFirstPartyMediaUrl(p.url) || optimizerFailures.has(p.url)}
                fill
                sizes="64px"
                className="object-cover"
                onError={() => {
                  if (!isFirstPartyMediaUrl(p.url) || optimizerFailures.has(p.url)) return;
                  setOptimizerFailures((current) => new Set(current).add(p.url));
                }}
              />
            </button>
          ))}
        </div>
      )}

      {/* Lightbox. On body, so the sticky gallery column cannot trap it
          under the site header. */}
      {lightboxOpen && createPortal(
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Image lightbox"
          tabIndex={-1}
          className="lightbox-backdrop-in fixed inset-0 z-[9999] flex touch-manipulation items-center justify-center bg-black/90"
          onClick={closeViewer}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <button
            onClick={closeViewer}
            className="absolute right-[calc(1rem+env(safe-area-inset-right))] top-[calc(1rem+env(safe-area-inset-top))] z-10 inline-flex min-h-11 min-w-11 items-center justify-center border-0 bg-transparent text-2xl font-light text-white shadow-none outline-none ring-0 hover:text-neutral-300 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            aria-label="Close"
          >
            <span aria-hidden="true">✕</span>
          </button>

          {photos.length > 1 && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  showPreviousLightboxPhoto();
                }}
                className="absolute left-[calc(1rem+env(safe-area-inset-left))] z-10 inline-flex min-h-11 min-w-11 items-center justify-center text-white hover:text-neutral-300"
                aria-label="Previous image"
              >
                <ChevronLeft size={28} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  showNextLightboxPhoto();
                }}
                className="absolute right-[calc(1rem+env(safe-area-inset-right))] z-10 inline-flex min-h-11 min-w-11 items-center justify-center text-white hover:text-neutral-300"
                aria-label="Next image"
              >
                <ChevronRight size={28} />
              </button>
            </>
          )}

          <div onClick={(e) => e.stopPropagation()} className="lightbox-photo-in max-w-4xl max-h-[85dvh] mx-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={lightboxPhotoRef}
              src={photos[lightboxIndex]?.url}
              alt={photos[lightboxIndex]?.altText ?? `${title} — photo ${lightboxIndex + 1}`}
              className="max-w-full max-h-[85dvh] object-contain"
              onLoad={(e) => {
                if (!lightboxSwapRef.current) return;
                lightboxSwapRef.current = false;
                playPhotoSwap(e.currentTarget);
              }}
            />
            {photos.length > 1 && (
              <p className="text-center text-white text-sm mt-2 opacity-60">
                {lightboxIndex + 1} / {photos.length}
              </p>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// Settle the shown photo without changing opacity. Starting a post-load fade
// at partial opacity made every arrow click and swipe flash pale.
function playPhotoSwap(img: HTMLImageElement) {
  if (typeof img.animate !== "function") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  img.animate(
    [
      { transform: "scale(1.01)" },
      { transform: "scale(1)" },
    ],
    { duration: 220, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
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
    if (!touch || event.touches.length > 1 || isPageZoomed()) return;

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
