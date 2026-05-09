"use client";

import { useState } from "react";
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
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt="Workshop"
          className="h-40 w-full rounded-lg border border-neutral-200 object-cover shadow-sm"
        />
      ) : (
        <div className="flex h-40 w-full items-center justify-center rounded-lg border border-dashed border-neutral-200 bg-white text-sm text-neutral-500">
          No workshop image yet
        </div>
      )}

      <UploadButton
        endpoint="galleryImage"
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
