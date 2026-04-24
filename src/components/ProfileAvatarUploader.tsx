"use client";

import { useState } from "react";
import { UploadButton } from "@/utils/uploadthing";
import { emitToast } from "@/components/Toast";

export default function ProfileAvatarUploader({
  initialUrl,
}: {
  initialUrl?: string | null;
}) {
  const [url, setUrl] = useState<string | null>(initialUrl ?? null);

  return (
    <div className="flex items-center gap-4">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt="Shop avatar"
          className="h-20 w-20 rounded-full border object-cover shrink-0"
        />
      ) : (
        <div className="h-20 w-20 rounded-full border bg-neutral-200 shrink-0" />
      )}

      <div>
        <UploadButton
          endpoint="galleryImage"
          appearance={{
            button: "bg-black text-white rounded px-3 py-2 hover:bg-neutral-800 text-sm",
            container: "inline-block",
            allowedContent: "hidden",
          }}
          content={{
            button: ({ ready }) => (ready ? "Upload avatar" : "Preparing…"),
          }}
          onClientUploadComplete={(files) => {
            const newUrl =
              (files[0] as { ufsUrl?: string; url?: string })?.ufsUrl ??
              (files[0] as { ufsUrl?: string; url?: string })?.url ??
              null;
            if (newUrl) setUrl(newUrl);
          }}
          onUploadError={(e) => emitToast(e.message, "error")}
        />
        <p className="mt-1 text-xs text-neutral-500">
          Square image recommended. Shown on your public profile.
        </p>
      </div>

      {/* Hidden input so the form submission includes the URL */}
      <input type="hidden" name="avatarImageUrl" value={url ?? ""} />
    </div>
  );
}
