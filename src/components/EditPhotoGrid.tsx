"use client";

import { useState, useRef, useTransition } from "react";
import { useBodyScrollLock, useDialogFocus } from "@/lib/dialogFocus";

type Photo = {
  id: string;
  url: string;
  altText: string | null;
};

export default function EditPhotoGrid({
  photos: initialPhotos,
  onReorder,
  onDelete,
  onSaveAltTexts,
}: {
  photos: Photo[];
  listingId: string;
  onReorder: (photoIds: string[]) => Promise<void>;
  onDelete: (photoId: string) => Promise<void>;
  onSaveAltTexts: (data: Record<string, string>) => Promise<void>;
}) {
  const [photos, setPhotos] = useState(initialPhotos);
  const [altTexts, setAltTexts] = useState<Record<string, string>>(
    Object.fromEntries(initialPhotos.map((p) => [p.id, p.altText ?? ""]))
  );
  const [saving, startSaving] = useTransition();
  const [toast, setToast] = useState<{ message: string; kind: "success" | "error" } | null>(null);
  const [altModalIdx, setAltModalIdx] = useState<number | null>(null);
  const altDialogRef = useRef<HTMLDivElement>(null);

  // Drag state
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const altModalOpen = altModalIdx !== null && !!photos[altModalIdx];

  useDialogFocus(altModalOpen, altDialogRef, () => setAltModalIdx(null));
  useBodyScrollLock(altModalOpen);

  function showToast(message: string, kind: "success" | "error" = "success") {
    setToast({ message, kind });
    setTimeout(() => setToast(null), 1800);
  }

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

    const previousPhotos = photos;
    const newPhotos = [...photos];
    const [dragged] = newPhotos.splice(from, 1);
    newPhotos.splice(to, 0, dragged);
    setPhotos(newPhotos);

    startSaving(() => {
      void onReorder(newPhotos.map((p) => p.id))
        .then(() => showToast("Reordered"))
        .catch(() => {
          setPhotos(previousPhotos);
          showToast("Couldn't reorder photos.", "error");
        });
    });
  }

  function movePhoto(from: number, to: number) {
    const previousPhotos = photos;
    const newPhotos = [...photos];
    const [moved] = newPhotos.splice(from, 1);
    newPhotos.splice(to, 0, moved);
    setPhotos(newPhotos);

    startSaving(() => {
      void onReorder(newPhotos.map((p) => p.id))
        .then(() => showToast("Reordered"))
        .catch(() => {
          setPhotos(previousPhotos);
          showToast("Couldn't reorder photos.", "error");
        });
    });
  }

  function handleDelete(idx: number) {
    const photo = photos[idx];
    if (!photo) return;
    const previousPhotos = photos;
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
    startSaving(() => {
      void onDelete(photo.id)
        .then(() => showToast("Removed"))
        .catch(() => {
          setPhotos(previousPhotos);
          showToast("Couldn't remove photo.", "error");
        });
    });
  }

  function saveAltTexts() {
    startSaving(() => {
      void onSaveAltTexts(altTexts)
        .then(() => showToast("Alt texts saved"))
        .catch(() => showToast("Couldn't save alt texts.", "error"));
    });
  }

  return (
    <div className="space-y-4">
      {toast && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-md px-3 py-2 text-sm text-white shadow ${
            toast.kind === "error" ? "bg-red-600" : "bg-green-600"
          }`}
        >
          {toast.message}
        </div>
      )}

      {photos.length === 0 ? (
        <p className="text-sm text-neutral-500">No photos yet.</p>
      ) : (
        <>
          <p className="text-xs text-neutral-500">Drag photos to reorder. First photo is the cover.</p>
          <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {photos.map((p, idx) => (
              <li
                key={p.id}
                draggable
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
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
                    src={p.url}
                    alt={altTexts[p.id] || ""}
                    className="aspect-square w-full object-cover"
                    draggable={false}
                  />
                  {idx === 0 && (
                    <span className="absolute left-2 top-2 rounded bg-black/80 px-2 py-0.5 text-xs text-white">
                      Cover
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDelete(idx)}
                    className="absolute right-2 top-2 flex min-h-11 min-w-11 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/85 transition-colors"
                    title="Remove photo"
                    aria-label={`Remove photo ${idx + 1}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>

                {/* Bottom controls */}
                <div className="p-2 flex flex-wrap items-center gap-2 text-xs" draggable={false}>
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      onClick={() => movePhoto(idx, idx - 1)}
                      disabled={idx === 0}
                      className="min-h-11 min-w-11 rounded border border-neutral-200 px-2 hover:bg-neutral-50 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move earlier"
                      aria-label={`Move photo ${idx + 1} earlier in order`}
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => movePhoto(idx, idx + 1)}
                      disabled={idx === photos.length - 1}
                      className="min-h-11 min-w-11 rounded border border-neutral-200 px-2 hover:bg-neutral-50 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move later"
                      aria-label={`Move photo ${idx + 1} later in order`}
                    >
                      →
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setAltModalIdx(idx)}
                      className="min-h-11 rounded border border-neutral-200 px-3 hover:bg-neutral-50"
                      title="Edit alt text"
                      aria-label={`Edit alt text for photo ${idx + 1}`}
                    >
                      {altTexts[p.id] ? "Alt \u2713" : "Alt"}
                    </button>
                    {idx !== 0 && (
                      <button
                        type="button"
                        onClick={() => movePhoto(idx, 0)}
                        className="min-h-11 rounded border border-neutral-200 px-3 hover:bg-neutral-50"
                        aria-label={`Make photo ${idx + 1} the cover photo`}
                      >
                        Cover
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={saveAltTexts}
            disabled={saving}
            className="rounded-md px-4 py-2 bg-neutral-900 text-white text-sm hover:bg-neutral-800 disabled:opacity-50"
          >
            {saving ? "Saving\u2026" : "Save alt texts"}
          </button>
        </>
      )}

      {/* Alt text modal */}
      {altModalIdx !== null && photos[altModalIdx] && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40"
          onClick={() => setAltModalIdx(null)}
        >
          <div
            ref={altDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-photo-alt-dialog-title"
            tabIndex={-1}
            className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="edit-photo-alt-dialog-title" className="text-sm font-semibold text-neutral-800">
              Alt text — Photo {altModalIdx + 1}
            </h3>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photos[altModalIdx].url}
              alt=""
              className="w-full aspect-video object-cover rounded-md"
            />
            <textarea
              value={altTexts[photos[altModalIdx].id] ?? ""}
              onChange={(e) =>
                setAltTexts((prev) => ({
                  ...prev,
                  [photos[altModalIdx].id]: e.target.value,
                }))
              }
              placeholder="Describe this image (e.g. 'Hand-carved walnut dining table with live edge')"
              maxLength={200}
              rows={3}
              className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm placeholder:text-neutral-500"
            />
            <p className="text-xs text-neutral-500">
              Improves visibility in Google Image Search. If left blank, AI will generate alt text automatically and you can see it on the edit page.
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
