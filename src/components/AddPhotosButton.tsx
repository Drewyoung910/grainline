// src/components/AddPhotosButton.tsx
"use client";

import { useRouter } from "next/navigation";
import UploadButton from "@/components/R2UploadButton";
import { emitToast } from "@/components/Toast";
import { uploadedFileUrls } from "@/lib/uploadedFileUrl";

type AddPhotosResponse = {
  added?: number;
  warning?: string;
  error?: string;
  /** True when adding photos flipped an ACTIVE listing into re-review.
      Used to surface a clear explanation instead of letting the status
      badge silently change. */
  reviewPending?: boolean;
};

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
        You&rsquo;ve reached the max (10 photos). Remove one to add more.
      </p>
    );
  }

  return (
    <UploadButton
      endpoint="listingImage"
      // No upload-time crop on listing photos: store the original aspect so the
      // lightbox shows the full image. Cards/listing detail use object-cover at
      // aspect-[4/5] for visual consistency. Sellers can use Re-crop later to
      // control thumbnail framing.
      // Make the button obvious
      appearance={{
        container: "inline-block",
        button:
          "rounded-md bg-neutral-900 text-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-300",
        allowedContent: "hidden",
      }}
      content={{
        // Replace default text "Choose Files"
        button({ ready }) {
          return ready ? "Add photos" : "Connecting…";
        },
      }}
      onClientUploadComplete={async (files) => {
        const urls = uploadedFileUrls(files);
        if (urls.length === 0) {
          emitToast("Upload finished, but no usable photo URLs were returned.", "error");
          return;
        }

        let res: Response;
        try {
          res = await fetch(`/api/listings/${listingId}/photos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ urls }),
          });
        } catch {
          emitToast("Photos uploaded, but they could not be attached to the listing.", "error");
          return;
        }

        const body = await res.json().catch(() => ({} as AddPhotosResponse)) as AddPhotosResponse;
        if (!res.ok) {
          emitToast(body.error ?? "Photos uploaded, but they could not be attached to the listing.", "error");
          return;
        }

        if (body.warning) {
          emitToast(body.warning, "info");
        } else if ((body.added ?? urls.length) > 0) {
          const added = body.added ?? urls.length;
          if (body.reviewPending) {
            // Active listings whose photos change get auto-flipped to
            // PENDING_REVIEW by the API so the new image set goes through
            // moderation. Tell the seller that, so the status badge flip
            // doesn't look like a phantom publish.
            emitToast(
              `${added} photo${added === 1 ? "" : "s"} added — your listing is being re-reviewed. It will return to active once approved.`,
              "info",
            );
          } else {
            emitToast(`${added} photo${added === 1 ? "" : "s"} added.`, "success");
          }
        } else {
          emitToast("No new photos were added.", "info");
        }

        router.refresh();
      }}
      onUploadError={(e) => emitToast(e.message, "error")}
    />
  );
}
