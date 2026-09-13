// src/components/GalleryUploader.tsx
"use client";

import * as React from "react";
import ImageRecropButton from "@/components/ImageRecropButton";
import UploadButton from "@/components/R2UploadButton";
import { emitToast } from "@/components/Toast";
import { uploadedFileUrls } from "@/lib/uploadedFileUrl";

export default function GalleryUploader({
  initialUrls = [],
  initialAltTexts = [],
  maxImages = 8,
}: {
  initialUrls?: string[];
  initialAltTexts?: string[];
  maxImages?: number;
}) {
  const [urls, setUrls] = React.useState<string[]>(initialUrls);
  const [altTexts, setAltTexts] = React.useState<string[]>(() =>
    initialUrls.map((_, index) => initialAltTexts[index] ?? ""),
  );
  const [altEditingIndex, setAltEditingIndex] = React.useState<number | null>(null);
  const [altDraft, setAltDraft] = React.useState("");
  const dragItem = React.useRef<number | null>(null);
  const dragOverItem = React.useRef<number | null>(null);

  function updateUrlsAndAlts(nextUrls: string[], nextAlts: string[]) {
    setUrls(nextUrls);
    setAltTexts(nextUrls.map((_, index) => nextAlts[index] ?? ""));
  }

  function removePhoto(index: number) {
    updateUrlsAndAlts(
      urls.filter((_, i) => i !== index),
      altTexts.filter((_, i) => i !== index),
    );
  }

  function movePhoto(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= urls.length || to >= urls.length) return;
    const nextUrls = [...urls];
    const nextAlts = [...altTexts];
    const [url] = nextUrls.splice(from, 1);
    const [alt] = nextAlts.splice(from, 1);
    nextUrls.splice(to, 0, url);
    nextAlts.splice(to, 0, alt ?? "");
    updateUrlsAndAlts(nextUrls, nextAlts);
  }

  function handleDrop() {
    if (dragItem.current == null || dragOverItem.current == null) return;
    movePhoto(dragItem.current, dragOverItem.current);
    dragItem.current = null;
    dragOverItem.current = null;
  }

  function openAltEditor(index: number) {
    setAltEditingIndex(index);
    setAltDraft(altTexts[index] ?? "");
  }

  function saveAltText() {
    if (altEditingIndex == null) return;
    setAltTexts((prev) => prev.map((value, index) => (index === altEditingIndex ? altDraft.slice(0, 240) : value)));
    setAltEditingIndex(null);
    setAltDraft("");
  }

  return (
    <div className="space-y-3">
      {/* Hidden inputs for form submission */}
      <input type="hidden" name="galleryImageUrlsTouched" value="1" />
      {urls.map((url, i) => (
        <React.Fragment key={`${url}:${i}`}>
          <input type="hidden" name="galleryImageUrls" value={url} />
          <input type="hidden" name="galleryAltTexts" value={altTexts[i] ?? ""} />
        </React.Fragment>
      ))}

      {/* Existing images grid */}
      {urls.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {urls.map((url, i) => (
            <div
              key={`${url}:${i}`}
              className="group relative"
              draggable
              onDragStart={() => {
                dragItem.current = i;
              }}
              onDragEnter={() => {
                dragOverItem.current = i;
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`Gallery ${i + 1}`}
                className="aspect-[3/2] w-full rounded-md border border-neutral-200 object-cover"
              />
              <div className="absolute bottom-1 left-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                <div className="flex flex-wrap gap-1">
                  <ImageRecropButton
                    imageUrl={url}
                    endpoint="galleryImage"
                    cropAspect={3 / 2}
                    filename={`gallery-${i + 1}.jpg`}
                    label="Adjust"
                    onCropped={(newUrl) => setUrls((prev) => prev.map((value, index) => index === i ? newUrl : value))}
                    className="rounded-md bg-white/95 px-2 py-1 text-[11px] font-medium text-neutral-900 shadow-sm ring-1 ring-neutral-200 hover:bg-white disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => openAltEditor(i)}
                    className="rounded-md bg-white/95 px-2 py-1 text-[11px] font-medium text-neutral-900 shadow-sm ring-1 ring-neutral-200 hover:bg-white"
                  >
                    Alt
                  </button>
                </div>
              </div>
              <div className="absolute bottom-1 right-1 flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                <button
                  type="button"
                  onClick={() => movePhoto(i, i - 1)}
                  disabled={i === 0}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-neutral-200 bg-white text-xs shadow-sm hover:bg-neutral-50 disabled:opacity-40"
                  style={{ borderRadius: "9999px" }}
                  aria-label="Move photo left"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => movePhoto(i, i + 1)}
                  disabled={i === urls.length - 1}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-neutral-200 bg-white text-xs shadow-sm hover:bg-neutral-50 disabled:opacity-40"
                  style={{ borderRadius: "9999px" }}
                  aria-label="Move photo right"
                >
                  →
                </button>
              </div>
              <button
                type="button"
                onClick={() => removePhoto(i)}
                className="absolute top-1 right-1 bg-white border border-neutral-200 rounded-full h-7 w-7 text-sm flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity hover:bg-red-50 hover:text-red-600 after:absolute after:-inset-2"
                style={{ borderRadius: "9999px" }}
                aria-label="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {urls.length < maxImages && (
        <UploadButton
          endpoint="galleryImage"
          cropAspect={3 / 2}
          appearance={{
            button: "bg-neutral-900 text-white text-xs px-3 py-2 hover:bg-neutral-700",
            container: "inline-block",
            allowedContent: "hidden",
          }}
          content={{ button: ({ ready }) => (ready ? "Upload photos" : "Preparing…") }}
          onClientUploadComplete={(files) => {
            const newUrls = uploadedFileUrls(files);
            setUrls((prev) => [...prev, ...newUrls].slice(0, maxImages));
            setAltTexts((prev) => [...prev, ...newUrls.map(() => "")].slice(0, maxImages));
          }}
          onUploadError={(e) => emitToast(e.message, "error")}
        />
      )}

      <p className="text-xs text-neutral-500">
        {urls.length}/{maxImages} photos uploaded
      </p>

      {altEditingIndex != null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Edit gallery alt text"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h3 className="font-display text-lg font-semibold text-neutral-900">Image alt text</h3>
            <p className="mt-1 text-sm text-neutral-600">
              Shortly describe the image for screen readers and image search.
            </p>
            <textarea
              value={altDraft}
              onChange={(event) => setAltDraft(event.target.value)}
              rows={3}
              maxLength={240}
              className="mt-4 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
              placeholder="A maker sanding a walnut side table in the workshop"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setAltEditingIndex(null);
                  setAltDraft("");
                }}
                className="rounded-md border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveAltText}
                className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
              >
                Save alt text
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
