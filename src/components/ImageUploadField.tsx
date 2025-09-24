// src/components/ImageUploadField.tsx
"use client";

import { useState } from "react";
import { UploadButton } from "@/utils/uploadthing";

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
          // v7 returns ufsUrl; some setups still expose url — handle both
          // @ts-ignore
          setUrl(file?.ufsUrl ?? file?.url ?? "");
        }}
        onUploadError={(e) => alert(e.message)}
      />

      {!url && (
        <p className="text-xs text-gray-500 mt-1">
          Upload an image (max 8MB). After upload finishes, a preview appears.
        </p>
      )}
    </div>
  );
}
