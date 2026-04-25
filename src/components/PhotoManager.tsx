// src/components/PhotoManager.tsx
"use client";

import { useState, useCallback, useRef } from "react";
import UploadButton from "@/components/R2UploadButton";
import { emitToast } from "@/components/Toast";

type ManagedPhoto = {
  url: string;
  altText: string;
};

export default function PhotoManager({ max = 8 }: { max?: number }) {
  const [photos, setPhotos] = useState<ManagedPhoto[]>([]);
  const [altModalIdx, setAltModalIdx] = useState<number | null>(null);

  // Drag state
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  function handleDragStart(e: React.DragEvent, idx: number) {
    dragItem.current = idx;
    e.dataTransfer.effectAllowed = "move";
    const img = e.currentTarget.querySelector("img");
    if (img) e.dataTransfer.setDragImage(img, 50, 50);
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    dragOverItem.current = idx;
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const from = dragItem.current;
    const to = dragOverItem.current;
    dragItem.current = null;
    dragOverItem.current = null;
    if (from === null || to === null || from === to) return;

    setPhotos((prev) => {
      const next = [...prev];
      const [dragged] = next.splice(from, 1);
      next.splice(to, 0, dragged);
      return next;
    });
  }

  const moveUp = useCallback((index: number) => {
    if (index <= 0) return;
    setPhotos((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }, []);

  const moveDown = useCallback((index: number) => {
    setPhotos((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }, []);

  const remove = useCallback((index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateAltText = useCallback((index: number, text: string) => {
    setPhotos((prev) =>
      prev.map((p, i) => (i === index ? { ...p, altText: text } : p))
    );
  }, []);

  const makeCover = useCallback((index: number) => {
    if (index <= 0) return;
    setPhotos((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.unshift(moved);
      return next;
    });
  }, []);

  return (
    <div className="space-y-3">
      {photos.length < max && (
        <UploadButton
          endpoint="listingImage"
          appearance={{
            button:
              "bg-black text-white rounded px-3 py-2 hover:bg-neutral-800",
            container: "inline-block",
            allowedContent: "hidden",
          }}
          content={{
            button: ({ ready }) => (ready ? "Add photos" : "Preparing\u2026"),
          }}
          onClientUploadComplete={(files) => {
            const newPhotos: ManagedPhoto[] = files.map((f) => ({
              url: (f as { ufsUrl?: string }).ufsUrl ?? "",
              altText: "",
            }));
            setPhotos((prev) =>
              [...prev, ...newPhotos].slice(0, max)
            );
          }}
          onUploadError={(e) => emitToast(e.message, "error")}
        />
      )}

      <p className="text-xs text-neutral-400">
        Upload up to {max} photos (8MB each). First photo is the cover. Drag to reorder.
      </p>

      {/* Hidden inputs for form submission */}
      <input
        type="hidden"
        name="imageUrlsJson"
        value={JSON.stringify(photos.map((p) => p.url))}
      />
      <input
        type="hidden"
        name="imageAltTextsJson"
        value={JSON.stringify(photos.map((p) => p.altText))}
      />

      {photos.length > 0 && (
        <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {photos.map((photo, i) => (
            <li
              key={`${photo.url}-${i}`}
              draggable
              onDragStart={(e) => handleDragStart(e, i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={(e) => handleDrop(e)}
              onDragEnd={() => {
                dragItem.current = null;
                dragOverItem.current = null;
              }}
              className="rounded-lg border border-neutral-200 overflow-hidden bg-white select-none cursor-grab active:cursor-grabbing"
            >
              <div className="relative" draggable={false}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url}
                  alt={photo.altText || `Photo ${i + 1}`}
                  className="aspect-square w-full object-cover"
                  draggable={false}
                />
                {i === 0 && (
                  <span className="absolute left-2 top-2 rounded bg-black/80 px-2 py-0.5 text-xs text-white">
                    Cover
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white hover:bg-black/80 transition-colors"
                  title="Remove photo"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              {/* Bottom controls */}
              <div className="p-2 flex items-center justify-between text-xs" draggable={false}>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveUp(i)}
                    disabled={i === 0}
                    className="rounded border border-neutral-200 px-1.5 py-0.5 hover:bg-neutral-50 disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Move left"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={() => moveDown(i)}
                    disabled={i === photos.length - 1}
                    className="rounded border border-neutral-200 px-1.5 py-0.5 hover:bg-neutral-50 disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Move right"
                  >
                    →
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setAltModalIdx(i)}
                    className="rounded border border-neutral-200 px-2 py-0.5 hover:bg-neutral-50"
                    title="Edit alt text"
                  >
                    {photo.altText ? "Alt ✓" : "Alt"}
                  </button>
                  {i !== 0 && (
                    <button
                      type="button"
                      onClick={() => makeCover(i)}
                      className="rounded border border-neutral-200 px-2 py-0.5 hover:bg-neutral-50"
                    >
                      Cover
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Alt text modal */}
      {altModalIdx !== null && photos[altModalIdx] && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40"
          onClick={() => setAltModalIdx(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-neutral-800">
              Alt text — Photo {altModalIdx + 1}
            </h3>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photos[altModalIdx].url}
              alt=""
              className="w-full aspect-video object-cover rounded-md"
            />
            <textarea
              value={photos[altModalIdx].altText}
              onChange={(e) => updateAltText(altModalIdx, e.target.value)}
              placeholder="Describe this image (e.g. 'Hand-carved walnut dining table with live edge')"
              maxLength={200}
              rows={3}
              className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm placeholder:text-neutral-400"
            />
            <p className="text-xs text-neutral-400">
              Improves visibility in Google Image Search. If left blank, AI will generate alt text automatically.
            </p>
            <button
              type="button"
              onClick={() => setAltModalIdx(null)}
              className="w-full rounded-md bg-neutral-900 text-white py-2 text-sm hover:bg-neutral-800"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
