// src/components/AddPhotosButton.tsx
"use client";

import { useRouter } from "next/navigation";
import { UploadButton } from "@/utils/uploadthing";

export default function AddPhotosButton({
  listingId,
  remaining,
}: {
  listingId: string;
  remaining: number;
}) {
  const router = useRouter();

  if (remaining <= 0) {
    return (
      <p className="text-xs text-gray-500">
        You’ve reached the max (8 photos). Remove one to add more.
      </p>
    );
  }

  return (
    <UploadButton
      endpoint="listingImage"
      // Make the button obvious
      appearance={{
        container: "inline-block",
        button:
          "rounded-md bg-black text-white px-3 py-1.5 text-sm font-medium hover:bg-black/90 focus:outline-none focus:ring-2 focus:ring-black/40",
        allowedContent: "hidden",
      }}
      content={{
        // Replace default text "Choose Files"
        button({ ready }) {
          return ready ? "Add photos" : "Connecting…";
        },
      }}
      onClientUploadComplete={async (files) => {
       const urls = files.map((f) => (f as { ufsUrl?: string }).ufsUrl ?? "");

        await fetch(`/api/listings/${listingId}/photos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls }),
        });

        router.refresh();
      }}
      onUploadError={(e) => alert(e.message)}
    />
  );
}

