"use client";

import { useState } from "react";
import { UploadButton } from "@/utils/uploadthing";

export default function ProfileBannerUploader({
  initialUrl,
}: {
  initialUrl?: string | null;
}) {
  const [url, setUrl] = useState<string | null>(initialUrl ?? null);

  return (
    <div className="space-y-3">
      {/* Banner preview */}
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt="Shop banner"
          className="w-full h-40 object-cover rounded-lg border"
        />
      ) : (
        <div className="w-full h-40 rounded-lg border bg-gradient-to-r from-neutral-800 to-neutral-600 flex items-center justify-center text-white text-sm">
          No banner yet
        </div>
      )}

      <UploadButton
        endpoint="bannerImage"
        appearance={{
          button: "bg-black text-white rounded px-3 py-2 hover:bg-neutral-800 text-sm",
          container: "inline-block",
          allowedContent: "hidden",
        }}
        content={{
          button: ({ ready }) => (ready ? "Upload banner" : "Preparing…"),
        }}
        onClientUploadComplete={(files) => {
          const newUrl = (files[0] as { ufsUrl?: string; url?: string })?.ufsUrl ?? (files[0] as { ufsUrl?: string; url?: string })?.url ?? null;
          if (newUrl) setUrl(newUrl);
        }}
        onUploadError={(e) => alert(e.message)}
      />

      {/* Hidden input so the form submission includes the URL */}
      <input type="hidden" name="bannerImageUrl" value={url ?? ""} />
    </div>
  );
}
