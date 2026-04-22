"use client";

import { useState, useRef, useTransition } from "react";

type Photo = {
  id: string;
  url: string;
  altText: string | null;
};

export default function EditPhotoGrid({
  photos: initialPhotos,
  listingId,
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
  const [toast, setToast] = useState<string | null>(null);

  // Drag state
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }

  function handleDragStart(idx: number) {
    dragItem.current = idx;
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    dragOverItem.current = idx;
  }

  function handleDrop() {
    if (dragItem.current === null || dragOverItem.current === null) return;
    if (dragItem.current === dragOverItem.current) return;

    const newPhotos = [...photos];
    const [dragged] = newPhotos.splice(dragItem.current, 1);
    newPhotos.splice(dragOverItem.current, 0, dragged);
    setPhotos(newPhotos);

    dragItem.current = null;
    dragOverItem.current = null;

    startSaving(async () => {
      await onReorder(newPhotos.map((p) => p.id));
      showToast("Reordered");
    });
  }

  function movePhoto(from: number, to: number) {
    const newPhotos = [...photos];
    const [moved] = newPhotos.splice(from, 1);
    newPhotos.splice(to, 0, moved);
    setPhotos(newPhotos);

    startSaving(async () => {
      await onReorder(newPhotos.map((p) => p.id));
      showToast("Reordered");
    });
  }

  function handleDelete(idx: number) {
    const photo = photos[idx];
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
    startSaving(async () => {
      await onDelete(photo.id);
      showToast("Removed");
    });
  }

  function saveAltTexts() {
    startSaving(async () => {
      await onSaveAltTexts(altTexts);
      showToast("Alt texts saved");
    });
  }

  return (
    <div className="space-y-4">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-md bg-green-600 text-white px-3 py-2 shadow text-sm">
          {toast}
        </div>
      )}

      {photos.length === 0 ? (
        <p className="text-sm text-neutral-500">No photos yet.</p>
      ) : (
        <>
          <p className="text-xs text-neutral-400">Drag photos to reorder. First photo is the cover.</p>
          <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {photos.map((p, idx) => (
              <li
                key={p.id}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDrop={handleDrop}
                onDragEnd={() => {
                  dragItem.current = null;
                  dragOverItem.current = null;
                }}
                className="rounded-lg border border-neutral-200 overflow-hidden bg-white cursor-grab active:cursor-grabbing"
              >
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.url}
                    alt={p.altText || ""}
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
                    className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white hover:bg-black/80 transition-colors"
                    title="Remove photo"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>

                {/* Alt text */}
                <div className="p-2 space-y-1">
                  <input
                    type="text"
                    value={altTexts[p.id] ?? ""}
                    onChange={(e) =>
                      setAltTexts((prev) => ({ ...prev, [p.id]: e.target.value }))
                    }
                    placeholder="Describe this image (e.g. 'Hand-carved walnut dining table')"
                    maxLength={200}
                    className="w-full text-xs border border-neutral-200 rounded-md px-2.5 py-1.5 placeholder:text-neutral-400"
                  />
                  <p className="text-[10px] text-neutral-400">
                    Alt text improves visibility in Google Image Search
                  </p>
                </div>

                {/* Reorder + cover controls */}
                <div className="px-2 pb-2 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => movePhoto(idx, idx - 1)}
                      disabled={idx === 0}
                      className="rounded border border-neutral-200 px-1.5 py-0.5 hover:bg-neutral-50 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move left"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => movePhoto(idx, idx + 1)}
                      disabled={idx === photos.length - 1}
                      className="rounded border border-neutral-200 px-1.5 py-0.5 hover:bg-neutral-50 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move right"
                    >
                      →
                    </button>
                  </div>
                  {idx !== 0 && (
                    <button
                      type="button"
                      onClick={() => movePhoto(idx, 0)}
                      className="rounded border border-neutral-200 px-2 py-0.5 hover:bg-neutral-50"
                    >
                      Make cover
                    </button>
                  )}
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
    </div>
  );
}
