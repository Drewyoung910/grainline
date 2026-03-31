// src/components/GalleryUploader.tsx
"use client";

import * as React from "react";
import { UploadButton } from "@/utils/uploadthing";

export default function GalleryUploader({
  initialUrls = [],
  maxImages = 8,
}: {
  initialUrls?: string[];
  maxImages?: number;
}) {
  const [urls, setUrls] = React.useState<string[]>(initialUrls);

  return (
    <div className="space-y-3">
      {/* Hidden inputs for form submission */}
      {urls.map((url, i) => (
        <input key={i} type="hidden" name="galleryImageUrls" value={url} />
      ))}

      {/* Existing images grid */}
      {urls.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {urls.map((url, i) => (
            <div key={url} className="relative group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`Gallery ${i + 1}`}
                className="w-full h-20 object-cover border border-neutral-200"
              />
              <button
                type="button"
                onClick={() => setUrls((prev) => prev.filter((_, j) => j !== i))}
                className="absolute top-1 right-1 bg-white border border-neutral-200 rounded-full w-5 h-5 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50 hover:text-red-600"
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
          appearance={{
            button: "bg-neutral-900 text-white text-xs px-3 py-2 hover:bg-neutral-700",
            container: "inline-block",
            allowedContent: "hidden",
          }}
          content={{ button: ({ ready }) => (ready ? "Upload photos" : "Preparing…") }}
          onClientUploadComplete={(files) => {
            const newUrls = files
              .map((f) => (f as { ufsUrl?: string }).ufsUrl ?? "")
              .filter(Boolean);
            setUrls((prev) => [...prev, ...newUrls].slice(0, maxImages));
          }}
          onUploadError={() => {}}
        />
      )}

      <p className="text-xs text-neutral-400">
        {urls.length}/{maxImages} photos uploaded
      </p>
    </div>
  );
}
