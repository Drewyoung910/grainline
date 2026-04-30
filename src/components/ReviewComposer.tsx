// src/components/ReviewComposer.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import UploadButton from "@/components/R2UploadButton";
import { useToast } from "@/components/Toast";
import { uploadedFileUrl } from "@/lib/uploadedFileUrl";

type Existing = {
  id: string;
  ratingX2: number;               // stored as 2..10
  comment: string | null;
  photos: { id: string; url: string }[];
  locked: boolean;                // already enforced server-side too
};

export default function ReviewComposer(props: {
  listingId: string;
  /** Can the viewer create a *new* review (90d + verified purchase)? */
  canReview: boolean;
  /** Does the viewer already have a review for this listing? */
  hasReview: boolean;
  /** If editing, pass the existing review */
  existing?: Existing | null;
  /** Force editor mode (used by “My review → Edit”) */
  isEditing?: boolean;
}) {
  const { listingId, canReview, hasReview, existing, isEditing = false } = props;
  const router = useRouter();
  const { toast } = useToast();

  // Derived mode
  const editing = !!isEditing && !!existing;
  const creating = !editing;

  // Local form state
  const [comment, setComment] = React.useState<string>(existing?.comment ?? "");
  // ratingX2 in half-star steps (2..10). default 8 = 4.0 stars
  const [ratingX2, setRatingX2] = React.useState<number>(existing?.ratingX2 ?? 8);

  // Photos: treat as one merged list of URLs. For existing photos, we only care about URL.
  const [photoUrls, setPhotoUrls] = React.useState<string[]>(
    existing?.photos?.map((p) => p.url) ?? []
  );

  // If user cannot create AND not editing, just show the info box.
  if (creating && (!canReview || hasReview)) {
    return (
      <div className="card-section px-4 py-3 text-sm text-neutral-700">
        You can post a review within 90 days of a completed purchase.
      </div>
    );
  }

  // Stars renderer (live preview while selecting)
  const stars = ratingX2 / 2; // 1.0 .. 5.0 in 0.5 steps
  const pct = (stars / 5) * 100;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    const payload = editing ? {
      ratingX2,
      comment: comment.trim(),
      photos: photoUrls.slice(0, 6), // existing PATCH contract
    } : {
      listingId,
      ratingX2,
      comment: comment.trim(),
      photoUrls: photoUrls.slice(0, 6), // existing POST contract
    };

    const res = await fetch(
      editing ? `/api/reviews/${existing!.id}` : "/api/reviews",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast(j?.error || "Something went wrong.", "error");
      return;
    }

    // After editing: strip ?redit=1, keep other params (e.g., rsort),
    // and jump back to #reviews (same page view, updated content).
    if (editing) {
      const url = new URL(window.location.href);
      url.searchParams.delete("redit");
      url.hash = "reviews";
      router.replace(url.pathname + url.search + url.hash);
      // Optional: force data refresh after replace if needed
      router.refresh();
      return;
    }

    // After creating: just refresh in place
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card-section p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{editing ? "Edit your review" : "Write a review"}</h3>
        {/* Star preview + numeric select */}
        <div className="flex items-center gap-3">
          <div className="relative leading-none" title={`${stars.toFixed(1)} out of 5`}>
            <div className="text-neutral-300">★★★★★</div>
            <div className="absolute inset-0 overflow-hidden" style={{ width: `${pct}%` }}>
              <div className="text-amber-500">★★★★★</div>
            </div>
          </div>
          <select
            className="rounded border px-2 py-1 text-sm"
            value={ratingX2}
            onChange={(e) => setRatingX2(parseInt(e.target.value, 10))}
          >
            {[2,3,4,5,6,7,8,9,10].map((x) => (
              <option key={x} value={x}>
                {(x / 2).toFixed(1)} ★
              </option>
            ))}
          </select>
        </div>
      </div>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={4}
        placeholder="Share details about the item, quality, fit, etc."
        className="w-full rounded border px-3 py-2"
      />

      {/* Thumbs */}
      {photoUrls.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {photoUrls.map((url, i) => (
            <div key={url + i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-16 w-16 rounded-lg object-cover border" />
              <button
                type="button"
                title="Remove"
                onClick={() => setPhotoUrls(photoUrls.filter((u) => u !== url))}
                className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-black/80 text-white text-xs"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Visible Add photos button */}
      <UploadButton
        endpoint="messageImage"
        onClientUploadComplete={(res) => {
          const first = res?.[0];
          const url = uploadedFileUrl(first);
          if (url) setPhotoUrls((prev) => (prev.includes(url) ? prev : [...prev, url]).slice(0, 6));
        }}
        onUploadError={(e: Error) => toast(e?.message || "Upload failed", "error")}
        appearance={{
          button:
            "inline-flex items-center gap-2 rounded-full px-3 py-1 bg-black text-white hover:bg-neutral-800",
          allowedContent: "text-xs text-neutral-500",
        }}
        content={{
          button: <span>＋ Add photos</span>,
          allowedContent: <>Images up to 8MB, max 6</>,
        }}
      />

      <div className="text-xs text-neutral-600">
        Photos are optional (up to 6). Star rating allows half-stars. Reviews lock if the seller replies.
      </div>

      <div className="pt-1">
        <button
          type="submit"
          className="rounded-full bg-black px-4 py-2 text-white hover:bg-neutral-800"
          disabled={editing && existing?.locked}
          title={editing && existing?.locked ? "This review is locked" : undefined}
        >
          {editing ? "Save changes" : "Post review"}
        </button>
      </div>
    </form>
  );
}
