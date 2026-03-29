// src/components/ReviewPhotosPicker.tsx
"use client";

import * as React from "react";
import { useUploadThing } from "@/utils/uploadthing";

type Att = { id: string; name: string; url?: string; uploading: boolean };

export default function ReviewPhotosPicker({
  initial = [],
  max = 6,
  fieldName = "photosJson",
}: {
  initial?: string[];  // preexisting URLs for edit
  max?: number;
  fieldName?: string;  // hidden input name with JSON of urls
}) {
  const [atts, setAtts] = React.useState<Att[]>(
    initial.slice(0, max).map((u) => ({
      id: crypto.randomUUID(),
      name: u.split("/").pop() || "photo",
      url: u,
      uploading: false,
    }))
  );
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  const ut = useUploadThing("reviewPhoto", {
    onUploadError: (e) => alert(e?.message ?? "Upload failed"),
  });

  const urls = atts.filter((a) => a.url && !a.uploading).map((a) => a.url!) as string[];
  const isUploading = atts.some((a) => a.uploading);

  function openPicker() {
    fileRef.current?.click();
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    // capacity left
    const left = Math.max(0, max - atts.length);
    const chosen = files.slice(0, left);
    if (!chosen.length) {
      e.target.value = "";
      return;
    }

    const tempIds = chosen.map(() => crypto.randomUUID());
    setAtts((prev) => [
      ...prev,
      ...chosen.map((f, i) => ({
        id: tempIds[i],
        name: f.name,
        uploading: true,
      })),
    ]);

    try {
      const res = await ut.startUpload(chosen);
      const got = (res ?? []).map((x) => x?.ufsUrl ?? (x?.key ? `https://utfs.io/f/${x.key}` : null));

      setAtts((prev) =>
        prev.map((a) => {
          const idx = tempIds.indexOf(a.id);
          if (idx === -1) return a;
          const u = got[idx] ?? null;
          if (!u) return a; // keep uploading if missing
          return { ...a, url: u, uploading: false };
        })
      );
    } catch {
      // drop those temp entries
      setAtts((prev) => prev.filter((a) => !tempIds.includes(a.id)));
    } finally {
      e.target.value = "";
    }
  }

  function remove(id: string) {
    setAtts((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="space-y-2">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={onPick}
      />

      <div className="flex flex-wrap gap-2">
        {atts.map((a) => (
          <div
            key={a.id}
            className="relative h-16 w-16 overflow-hidden rounded border bg-neutral-50"
            title={a.name}
          >
            {a.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.url} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[11px] text-neutral-500">
                Uploading…
              </div>
            )}
            {!a.uploading && (
              <button
                type="button"
                onClick={() => remove(a.id)}
                className="absolute right-0 top-0 m-0.5 rounded bg-black/70 px-1 text-[10px] text-white"
                aria-label="Remove photo"
                title="Remove"
              >
                ×
              </button>
            )}
          </div>
        ))}

        {atts.length < max && (
          <button
            type="button"
            onClick={openPicker}
            className="h-16 w-16 rounded border text-xs text-neutral-600 hover:bg-neutral-50"
            aria-label="Add photos"
            title="Add photos"
            disabled={isUploading}
          >
            + Add
          </button>
        )}
      </div>

      {/* Pass only finished URLs to the server */}
      <input type="hidden" name={fieldName} value={JSON.stringify(urls)} />
    </div>
  );
}
