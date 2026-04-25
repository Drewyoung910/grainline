// src/components/ImagesUploader.tsx
"use client";

import { useState } from "react";
import UploadButton from "@/components/R2UploadButton";
import { emitToast } from "@/components/Toast";

export default function ImagesUploader({
  max = 8,
  fieldName = "imageUrls",
}: {
  max?: number;
  fieldName?: string;
}) {
  const [urls, setUrls] = useState<string[]>([]);

  return (
    <div className="space-y-3">
      <UploadButton
        endpoint="listingImage"
        // Make the button black & visible
        appearance={{
          button: "bg-black text-white rounded px-3 py-2 hover:bg-neutral-800",
          container: "inline-block",
          allowedContent: "hidden", // we'll show our own helper text below
        }}
        content={{
          button: ({ ready }) => (ready ? "Add photos" : "Preparing…"),
        }}
        onClientUploadComplete={(files) => {
          const newUrls = files.map((f) => (f as { ufsUrl?: string }).ufsUrl ?? "");
          setUrls((prev) => [...prev, ...newUrls].slice(0, max));
        }}
        onUploadError={(e) => emitToast(e.message, "error")}
      />

      <p className="text-xs text-gray-500">
        Upload up to {max} photos (8MB each).
      </p>

      <div className="grid grid-cols-3 gap-3">
        {urls.map((u, i) => (
          <div key={u} className="relative">
            {/* Hidden inputs submit URLs with the form */}
            <input type="hidden" name={fieldName} value={u} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={u}
              alt={`photo ${i + 1}`}
              className="h-24 w-full object-cover rounded border"
            />
          </div>
        ))}
      </div>
    </div>
  );
}


