// src/components/PhotoManager.tsx
"use client";

import { useState, useCallback } from "react";
import { UploadButton } from "@/utils/uploadthing";

type ManagedPhoto = {
  url: string;
  altText: string;
};

export default function PhotoManager({ max = 8 }: { max?: number }) {
  const [photos, setPhotos] = useState<ManagedPhoto[]>([]);

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
          onUploadError={(e) => alert(e.message)}
        />
      )}

      <p className="text-xs text-gray-500">
        Upload up to {max} photos (8MB each). First photo is the cover.
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
              className="rounded-lg border border-neutral-200 overflow-hidden bg-white"
            >
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url}
                  alt={photo.altText || `Photo ${i + 1}`}
                  className="aspect-square w-full object-cover"
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
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              {/* Alt text input */}
              <div className="p-2 space-y-1">
                <input
                  type="text"
                  value={photo.altText}
                  onChange={(e) => updateAltText(i, e.target.value)}
                  placeholder="Describe this image (e.g. 'Hand-carved walnut dining table')"
                  maxLength={200}
                  className="w-full text-xs border border-neutral-200 rounded-md px-2.5 py-1.5 placeholder:text-neutral-400"
                />
                <p className="text-[10px] text-neutral-400">
                  Alt text improves visibility in Google Image Search
                </p>
              </div>

              {/* Reorder + cover controls */}
              <div className="p-2 flex items-center justify-between text-xs">
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
                {i !== 0 && (
                  <button
                    type="button"
                    onClick={() => makeCover(i)}
                    className="rounded border border-neutral-200 px-2 py-0.5 hover:bg-neutral-50"
                  >
                    Make cover
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
