"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useBodyScrollLock, useDialogFocus } from "@/lib/dialogFocus";
import { publicListingPath } from "@/lib/publicPaths";

export type CustomerPhoto = {
  id: string;
  url: string;
  altText: string | null;
  listingId: string;
  listingTitle: string | null;
};

type Props = {
  photos: CustomerPhoto[];
};

export default function CustomerPhotosGallery({ photos }: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number>(0);
  const touchEndX = useRef<number>(0);

  const open = openIndex !== null;

  useDialogFocus(open, dialogRef, () => setOpenIndex(null));
  useBodyScrollLock(open);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (openIndex === null) return;
      if (e.key === "ArrowRight") setOpenIndex((i) => (i === null ? 0 : (i + 1) % photos.length));
      if (e.key === "ArrowLeft") setOpenIndex((i) => (i === null ? 0 : (i - 1 + photos.length) % photos.length));
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [openIndex, photos.length]);

  if (photos.length === 0) return null;

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.targetTouches[0].clientX;
  }
  function handleTouchMove(e: React.TouchEvent) {
    touchEndX.current = e.targetTouches[0].clientX;
  }
  function handleTouchEnd() {
    const diff = touchStartX.current - touchEndX.current;
    if (Math.abs(diff) < 50) return;
    if (diff > 0) setOpenIndex((i) => (i === null ? 0 : (i + 1) % photos.length));
    else setOpenIndex((i) => (i === null ? 0 : (i - 1 + photos.length) % photos.length));
  }

  const activePhoto = openIndex !== null ? photos[openIndex] : null;

  return (
    <>
      {/* Masonry grid */}
      <div className="columns-2 sm:columns-3 lg:columns-4 gap-3 [&>*]:mb-3 [&>*]:break-inside-avoid">
        {photos.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setOpenIndex(i)}
            className="block w-full overflow-hidden rounded-lg ring-1 ring-neutral-200 transition-transform hover:-translate-y-0.5 duration-200 cursor-zoom-in"
            aria-label={`Open photo${p.listingTitle ? ` of ${p.listingTitle}` : ""}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.url}
              alt={p.altText ?? `Customer photo${p.listingTitle ? ` of ${p.listingTitle}` : ""}`}
              loading="lazy"
              className="w-full h-auto object-cover"
            />
          </button>
        ))}
      </div>

      {/* Lightbox */}
      {open && activePhoto && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Customer photo"
          tabIndex={-1}
          className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center"
          onClick={() => setOpenIndex(null)}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpenIndex(null);
            }}
            className="absolute right-4 top-4 z-10 inline-flex min-h-11 min-w-11 items-center justify-center text-2xl font-light text-white hover:text-neutral-300"
            aria-label="Close"
          >
            ✕
          </button>

          {photos.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenIndex((i) => (i === null ? 0 : (i - 1 + photos.length) % photos.length));
                }}
                className="absolute left-4 top-1/2 -translate-y-1/2 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60"
                aria-label="Previous photo"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenIndex((i) => (i === null ? 0 : (i + 1) % photos.length));
                }}
                className="absolute right-4 top-1/2 -translate-y-1/2 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60"
                aria-label="Next photo"
              >
                ›
              </button>
            </>
          )}

          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-5xl max-h-[85vh] mx-4 flex flex-col items-center gap-3"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={activePhoto.url}
              alt={activePhoto.altText ?? `Customer photo${activePhoto.listingTitle ? ` of ${activePhoto.listingTitle}` : ""}`}
              className="max-w-full max-h-[75vh] object-contain rounded-md"
            />
            <div className="flex items-center gap-4 text-sm text-white/90">
              <Link
                href={`${publicListingPath(activePhoto.listingId, activePhoto.listingTitle ?? "")}#reviews`}
                className="inline-flex items-center gap-1 underline hover:text-white"
                onClick={() => setOpenIndex(null)}
              >
                View review →
              </Link>
              {photos.length > 1 && (
                <span className="text-xs text-white/60">
                  {openIndex! + 1} / {photos.length}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
