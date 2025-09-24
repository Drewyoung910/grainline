"use client";

import { useState } from "react";
import { UploadButton } from "uploadthing/react";

export default function VideoUploader({ name = "videoUrl" }: { name?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-3">
      <UploadButton
        endpoint="listingVideo"
        onUploadProgress={() => setBusy(true)}
        onClientUploadComplete={(files) => {
          setBusy(false);
          const u = files?.[0]?.url ?? null;
          setUrl(u);
        }}
        onUploadError={(e) => {
          setBusy(false);
          alert(e.message);
        }}
      />
      <p className="text-xs text-gray-500">Optional video (max 100MB).</p>

      {url && <video src={url} controls className="w-full max-h-64 rounded border" />}

      {/* passes URL to the server action via the form */}
      <input type="hidden" name={name} value={url ?? ""} />
      {busy && <div className="text-sm text-gray-600">Uploading…</div>}
    </div>
  );
}
