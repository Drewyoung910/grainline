"use client";

import { useState } from "react";
import UploadButton from "@/components/R2UploadButton";
import { emitToast } from "@/components/Toast";

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
          className="w-full h-40 object-cover rounded-lg border"
        />
      ) : (
        <div className="w-full h-40 rounded-lg border bg-neutral-100 flex items-center justify-center text-neutral-400 text-sm">
          No workshop image yet
        </div>
      )}

      <UploadButton
        endpoint="galleryImage"
        appearance={{
          button: "bg-black text-white rounded px-3 py-2 hover:bg-neutral-800 text-sm",
          container: "inline-block",
          allowedContent: "hidden",
        }}
        content={{
          button: ({ ready }) => (ready ? "Upload workshop photo" : "Preparing…"),
        }}
        onClientUploadComplete={(files) => {
          const newUrl = (files[0] as { ufsUrl?: string; url?: string })?.ufsUrl ?? (files[0] as { ufsUrl?: string; url?: string })?.url ?? null;
          if (newUrl) setUrl(newUrl);
        }}
        onUploadError={(e) => emitToast(e.message, "error")}
      />

      <input type="hidden" name="workshopImageUrl" value={url ?? ""} />
    </div>
  );
}
