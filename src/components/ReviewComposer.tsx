// src/components/ReviewComposer.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import UploadButton from "@/components/R2UploadButton";
import { useToast } from "@/components/Toast";
import { uploadedFileUrl } from "@/lib/uploadedFileUrl";
import { appendReviewPhotoUrl, MAX_REVIEW_PHOTOS, normalizeReviewPhotoUrls } from "@/lib/reviewPhotoState";

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
  const [submitting, setSubmitting] = React.useState(false);
  const ratingId = React.useId();
  const commentId = React.useId();
  const photoUrlsRef = React.useRef(photoUrls);
  React.useEffect(() => {
    photoUrlsRef.current = photoUrls;
  }, [photoUrls]);

  // If user cannot create AND not editing, just show the info box.
  if (creating && (!canReview || hasReview)) {
    return (
      <div className="rounded-lg border border-stone-200/60 shadow-sm bg-[#EFEAE0] px-4 py-3 text-sm text-neutral-600">
        You can post a review within 90 days of a completed purchase.
      </div>
    );
  }

  // Stars renderer (live preview while selecting)
  const stars = ratingX2 / 2; // 1.0 .. 5.0 in 0.5 steps
  const pct = (stars / 5) * 100;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    const payload = editing ? {
      ratingX2,
      comment: comment.trim(),
      photos: normalizeReviewPhotoUrls(photoUrls), // existing PATCH contract
    } : {
      listingId,
      ratingX2,
      comment: comment.trim(),
      photoUrls: normalizeReviewPhotoUrls(photoUrls), // existing POST contract
    };

    try {
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
        toast("Review updated.", "success");
        const url = new URL(window.location.href);
        url.searchParams.delete("redit");
        url.hash = "reviews";
        router.replace(url.pathname + url.search + url.hash);
        router.refresh();
        return;
      }

      // After creating: clear the form, refresh, confirm.
      toast("Review posted. Thanks for the feedback!", "success");
      setComment("");
      setRatingX2(8);
      setPhotoUrls([]);
      photoUrlsRef.current = [];
      router.refresh();
    } catch {
      toast("Could not submit your review. Check your connection and try again.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card-section p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{editing ? "Edit your review" : "Write a review"}</h3>
        {/* Star preview + numeric select */}
        <div className="flex items-center gap-3">
          <div className="relative leading-none" title={`${stars.toFixed(1)} out of 5`} role="img" aria-label={`${stars.toFixed(1)} out of 5 stars`}>
            <div className="text-neutral-300" aria-hidden="true">★★★★★</div>
            <div className="absolute inset-0 overflow-hidden" style={{ width: `${pct}%` }} aria-hidden="true">
              <div className="text-amber-500">★★★★★</div>
            </div>
          </div>
          <label htmlFor={ratingId} className="sr-only">Rating</label>
          <select
            id={ratingId}
            className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm"
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

      <label htmlFor={commentId} className="sr-only">Review comment</label>
      <textarea
        id={commentId}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={4}
        placeholder="Share details about the item, quality, fit, etc."
        className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
      />

      {/* Thumbs */}
      {photoUrls.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {photoUrls.map((url, i) => (
            <div key={url + i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-16 w-16 rounded-lg object-cover ring-1 ring-stone-200" />
              <button
                type="button"
                title="Remove"
                aria-label="Remove photo"
                onClick={() => setPhotoUrls(photoUrls.filter((u) => u !== url))}
                className="absolute -top-3 -right-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-neutral-900 text-white text-lg shadow-sm hover:bg-neutral-800 transition-colors"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Visible Add photos button */}
      <UploadButton
        endpoint="reviewPhoto"
        onClientUploadComplete={(res) => {
          const first = res?.[0];
          const url = uploadedFileUrl(first);
          const result = appendReviewPhotoUrl(photoUrlsRef.current, url);
          photoUrlsRef.current = result.urls;
          setPhotoUrls(result.urls);
          if (result.status === "limit") {
            toast(`Reviews can include up to ${MAX_REVIEW_PHOTOS} photos.`, "error");
          } else if (result.status === "duplicate") {
            toast("That photo is already attached.", "error");
          } else if (result.status === "empty") {
            toast("Upload finished, but no image URL was returned.", "error");
          }
        }}
        onUploadError={(e: Error) => toast(e?.message || "Upload failed", "error")}
        appearance={{
          button:
            "inline-flex items-center gap-2 rounded-full bg-[#EFEAE0] hover:bg-[#E3DCCB] text-neutral-800 px-3 py-1.5 text-xs font-medium transition-colors",
          allowedContent: "text-xs text-neutral-500",
        }}
        content={{
          button: <span>+ Add photos</span>,
          allowedContent: <>Images up to 8MB, max 6</>,
        }}
      />

      <div className="text-xs text-neutral-600">
        Photos are optional (up to 6). Star rating allows half-stars. Reviews lock if the seller replies.
      </div>

      <div className="pt-1">
        <button
          type="submit"
          className="inline-flex items-center rounded-md bg-[#2C1F1A] hover:bg-[#3A2A24] text-white px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
          disabled={submitting || (editing && existing?.locked)}
          title={editing && existing?.locked ? "This review is locked" : undefined}
        >
          {submitting ? (editing ? "Saving..." : "Posting...") : editing ? "Save changes" : "Post review"}
        </button>
      </div>
    </form>
  );
}
