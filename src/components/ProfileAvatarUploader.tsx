"use client";

import { useEffect, useState } from "react";
import UploadButton from "@/components/R2UploadButton";
import { emitToast } from "@/components/Toast";
import { uploadedFileUrl } from "@/lib/uploadedFileUrl";

export default function ProfileAvatarUploader({
  initialUrl,
  storageKey,
}: {
  initialUrl?: string | null;
  storageKey?: string;
}) {
  const [url, setUrl] = useState<string | null>(initialUrl ?? null);

  useEffect(() => {
    if (!storageKey || initialUrl) return;
    try {
      const storedUrl = window.sessionStorage.getItem(storageKey);
      if (storedUrl) setUrl(storedUrl);
    } catch {
      // Session storage is best-effort draft recovery only.
    }
  }, [initialUrl, storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      if (url) window.sessionStorage.setItem(storageKey, url);
      else window.sessionStorage.removeItem(storageKey);
    } catch {
      // Ignore storage failures; the hidden input still submits the current URL.
    }
  }, [storageKey, url]);

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
            const newUrl = uploadedFileUrl(files[0]) || null;
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
