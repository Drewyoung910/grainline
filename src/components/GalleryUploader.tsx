// src/components/GalleryUploader.tsx
"use client";

import * as React from "react";
import ImageRecropButton from "@/components/ImageRecropButton";
import UploadButton from "@/components/R2UploadButton";
import { emitToast } from "@/components/Toast";
import { uploadedFileUrls } from "@/lib/uploadedFileUrl";

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
      <input type="hidden" name="galleryImageUrlsTouched" value="1" />
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
                className="aspect-[3/2] w-full rounded-md border border-neutral-200 object-cover"
              />
              <div className="absolute bottom-1 left-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                <ImageRecropButton
                  imageUrl={url}
                  endpoint="galleryImage"
                  cropAspect={3 / 2}
                  filename={`gallery-${i + 1}.jpg`}
                  label="Adjust"
                  onCropped={(newUrl) => setUrls((prev) => prev.map((value, index) => index === i ? newUrl : value))}
                  className="rounded-md bg-white/95 px-2 py-1 text-[11px] font-medium text-neutral-900 shadow-sm ring-1 ring-neutral-200 hover:bg-white disabled:opacity-50"
                />
              </div>
              <button
                type="button"
                onClick={() => setUrls((prev) => prev.filter((_, j) => j !== i))}
                className="absolute top-1 right-1 bg-white border border-neutral-200 rounded-full h-7 w-7 text-sm flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity hover:bg-red-50 hover:text-red-600 after:absolute after:-inset-2"
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
          }}
          onUploadError={(e) => emitToast(e.message, "error")}
        />
      )}

      <p className="text-xs text-neutral-500">
        {urls.length}/{maxImages} photos uploaded
      </p>
    </div>
  );
}
