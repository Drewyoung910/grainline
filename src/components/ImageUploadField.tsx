// src/components/ImageUploadField.tsx
"use client";

import { useState } from "react";
import UploadButton from "@/components/R2UploadButton";
import { emitToast } from "@/components/Toast";
import { uploadedFileUrl } from "@/lib/uploadedFileUrl";

export default function ImageUploadField({
  name,
  defaultUrl,
}: {
  name: string;
  defaultUrl?: string;
}) {
  const [url, setUrl] = useState<string | undefined>(defaultUrl);

  return (
    <div>
      <input type="hidden" name={name} value={url ?? ""} />
      {url && (
        <div className="mb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="preview"
            className="h-40 w-40 object-cover rounded border"
          />
          <button
            type="button"
            className="mt-2 text-sm underline"
            onClick={() => setUrl(undefined)}
          >
            Remove
          </button>
        </div>
      )}

      <UploadButton
        endpoint="listingImage"
        onClientUploadComplete={(res) => {
          const file = res?.[0];
          setUrl(uploadedFileUrl(file));
        }}
        onUploadError={(e) => emitToast(e.message, "error")}
      />

      {!url && (
        <p className="text-xs text-gray-500 mt-1">
          Upload an image (max 8MB). After upload finishes, a preview appears.
        </p>
      )}
    </div>
  );
}
