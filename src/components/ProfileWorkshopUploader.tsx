"use client";

import { useState } from "react";
import ImageRecropButton from "@/components/ImageRecropButton";
import UploadButton from "@/components/R2UploadButton";
import { emitToast } from "@/components/Toast";
import { uploadedFileUrl } from "@/lib/uploadedFileUrl";

export default function ProfileWorkshopUploader({
  initialUrl,
}: {
  initialUrl?: string | null;
}) {
  const [url, setUrl] = useState<string | null>(initialUrl ?? null);

  return (
    <div className="space-y-3">
      {url ? (
        <div className="relative overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="Workshop"
            className="aspect-[3/2] w-full object-cover"
          />
          <div className="absolute bottom-2 right-2">
            <ImageRecropButton
              imageUrl={url}
              endpoint="galleryImage"
              cropAspect={3 / 2}
              filename="workshop-photo.jpg"
              onCropped={(newUrl) => setUrl(newUrl)}
              className="rounded-md bg-white/95 px-3 py-1.5 text-xs font-medium text-neutral-900 shadow-sm ring-1 ring-neutral-200 hover:bg-white disabled:opacity-50"
            />
          </div>
        </div>
      ) : (
        <div className="flex aspect-[3/2] w-full items-center justify-center rounded-lg border border-dashed border-neutral-200 bg-white text-sm text-neutral-500">
          No workshop image yet
        </div>
      )}

      <UploadButton
        endpoint="galleryImage"
        cropAspect={3 / 2}
        allowMultiple={false}
        appearance={{
          button: "rounded-md bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-800",
          container: "inline-block",
          allowedContent: "hidden",
        }}
        content={{
          button: ({ ready }) => (ready ? "Upload workshop photo" : "Preparing…"),
        }}
        onClientUploadComplete={(files) => {
          const newUrl = uploadedFileUrl(files[0]) || null;
          if (newUrl) setUrl(newUrl);
        }}
        onUploadError={(e) => emitToast(e.message, "error")}
      />

      <input type="hidden" name="workshopImageUrl" value={url ?? ""} />
    </div>
  );
}
