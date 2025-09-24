// src/components/ImagesUploader.tsx
"use client";

import { useState } from "react";
import { UploadButton } from "@uploadthing/react";
import type { OurFileRouter } from "@/app/api/uploadthing/route";

export default function ImagesUploader({
  max = 8,
  fieldName = "imageUrls",
  initialUrls = [],
}: {
  max?: number;
  fieldName?: string;
  initialUrls?: string[];
}) {
  const [urls, setUrls] = useState<string[]>(initialUrls);

  function removeAt(i: number) {
    setUrls((prev) => prev.filter((_, idx) => idx !== i));
  }

  const canUploadMore = urls.length < max;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {canUploadMore ? (
          <UploadButton<OurFileRouter>
            endpoint="listingImage"
            onClientUploadComplete={(files) => {
              const newUrls = files.map((f) => f.url);
              setUrls((prev) => [...prev, ...newUrls].slice(0, max));
            }}
            onUploadError={(e) => alert(e.message)}
          />
        ) : (
          <span className="text-sm text-gray-500">You’ve reached the {max}-photo limit.</span>
        )}
        <span className="text-xs text-gray-500">
          Upload up to {max} photos (8MB each).
        </span>
      </div>

      {urls.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {urls.map((u, i) => (
            <div key={u} className="relative">
              {/* submit values */}
              <input type="hidden" name={fieldName} value={u} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={u}
                alt={`photo ${i + 1}`}
                className="h-24 w-full object-cover rounded border"
              />
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="absolute right-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white"
                aria-label={`Remove photo ${i + 1}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
