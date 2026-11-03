"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CATEGORY_LABELS, CATEGORY_VALUES } from "@/lib/categories";
import UploadButton from "@/components/R2UploadButton";
import { emitToast } from "@/components/Toast";
import { uploadedFileUrls } from "@/lib/uploadedFileUrl";
import { parseMoneyInputToCents } from "@/lib/money";

export default function CommissionRequestForm({
  onPosted,
  onCancel,
  onDirtyChange,
  onSubmittingChange,
}: {
  onPosted: () => void;
  onCancel: () => void;
  // Lets a dialog ask before throwing away what was typed.
  onDirtyChange?: (dirty: boolean) => void;
  onSubmittingChange?: (submitting: boolean) => void;
}) {
  const router = useRouter();
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [budgetMin, setBudgetMin] = React.useState("");
  const [budgetMax, setBudgetMax] = React.useState("");
  const [timeline, setTimeline] = React.useState("");
  const [referenceImageUrls, setReferenceImageUrls] = React.useState<string[]>([]);
  const [scope, setScope] = React.useState<"national" | "local">("national");
  const [submitting, setSubmitting] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const errorRef = React.useRef<HTMLDivElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const fieldPrefix = React.useId();
  const titleId = `${fieldPrefix}-title`;
  const descriptionId = `${fieldPrefix}-description`;
  const categoryId = `${fieldPrefix}-category`;
  const timelineId = `${fieldPrefix}-timeline`;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim() || uploading) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/commission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          category: category || undefined,
          budgetMin: parseMoneyInputToCents(budgetMin) != null ? budgetMin : undefined,
          budgetMax: parseMoneyInputToCents(budgetMax) != null ? budgetMax : undefined,
          timeline: timeline.trim() || undefined,
          referenceImageUrls,
          isNational: scope === "national",
        }),
      });
      if (res.status === 401) {
        router.push("/sign-in?redirect_url=/commission/new");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to submit");
        return;
      }
      onPosted();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const dirty = Boolean(
    title || description || category || budgetMin || budgetMax || timeline || referenceImageUrls.length > 0 || uploading,
  );
  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  // A request being sent can't be taken back, so it can't be dismissed either.
  React.useEffect(() => {
    onSubmittingChange?.(submitting);
  }, [submitting, onSubmittingChange]);
  React.useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "nearest" });
  }, [error]);

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Title */}
        <div>
          <label htmlFor={titleId} className="block text-sm font-medium text-neutral-700 mb-1">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            id={titleId}
            value={title}
            autoComplete="off"
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            placeholder="e.g. Custom walnut dining table for 8"
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
            required
          />
          <p className="text-xs text-neutral-500 mt-1">{title.length}/100</p>
        </div>

        {/* Description */}
        <div>
          <label htmlFor={descriptionId} className="block text-sm font-medium text-neutral-700 mb-1">
            Description <span className="text-red-500">*</span>
          </label>
          <textarea
            id={descriptionId}
            value={description}
            autoComplete="off"
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
            rows={5}
            placeholder="Describe dimensions, wood type preferences, style, finish, any special requirements..."
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm resize-y"
            required
          />
          <p className="text-xs text-neutral-500 mt-1">{description.length}/1000</p>
        </div>

        {/* Category */}
        <div>
          <label htmlFor={categoryId} className="block text-sm font-medium text-neutral-700 mb-1">Category (optional)</label>
          <select
            id={categoryId}
            value={category}
            autoComplete="off"
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
          >
            <option value="">— Any category —</option>
            {CATEGORY_VALUES.map((cat) => (
              <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
            ))}
          </select>
        </div>

        {/* Budget */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Budget range (optional)</label>
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">$</span>
              <input
                type="text"
                inputMode="decimal"
                pattern={"\\d+(\\.\\d{1,2})?|\\.\\d{1,2}"}
                autoComplete="off"
                value={budgetMin}
                onChange={(e) => setBudgetMin(e.target.value)}
                placeholder="Min"
                className="w-full rounded-md border border-neutral-200 bg-white pl-7 pr-3 py-2 text-sm"
              />
            </div>
            <span className="text-neutral-500 text-sm">to</span>
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">$</span>
              <input
                type="text"
                inputMode="decimal"
                pattern={"\\d+(\\.\\d{1,2})?|\\.\\d{1,2}"}
                autoComplete="off"
                value={budgetMax}
                onChange={(e) => setBudgetMax(e.target.value)}
                placeholder="Max"
                className="w-full rounded-md border border-neutral-200 bg-white pl-7 pr-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div>
          <label htmlFor={timelineId} className="block text-sm font-medium text-neutral-700 mb-1">Timeline (optional)</label>
          <input
            id={timelineId}
            value={timeline}
            autoComplete="off"
            onChange={(e) => setTimeline(e.target.value)}
            maxLength={100}
            placeholder="e.g. Within 3 months, flexible"
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
          />
        </div>

        {/* Reference images */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            Reference images (optional, up to 3)
          </label>
          <p className="text-xs text-neutral-500 mb-2">
            Share photos of styles, finishes, or designs you like.
            Only upload images you own or have permission to share.
            Reference images are visible to makers who view your request.
          </p>
          {referenceImageUrls.length < 3 && (
            <UploadButton
              endpoint="messageImage"
              appearance={{
                button: "btn btn-primary btn-sm",
                container: "inline-block",
                allowedContent: "hidden",
              }}
              content={{ button: ({ ready }) => (ready ? "Upload photos" : "Preparing…") }}
              onUploadBegin={() => setUploading(true)}
              onClientUploadComplete={(files) => {
                setUploading(false);
                const newUrls = uploadedFileUrls(files);
                setReferenceImageUrls((prev) => [...prev, ...newUrls].slice(0, 3));
              }}
              onUploadError={(e) => {
                setUploading(false);
                emitToast(e.message || "Upload failed", "error");
              }}
            />
          )}
          {referenceImageUrls.length > 0 && (
            <div className="flex gap-2 mt-2 flex-wrap">
              {referenceImageUrls.map((url, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="w-16 h-16 rounded-md object-cover border border-neutral-200" />
                  <button
                    type="button"
                    onClick={() => setReferenceImageUrls((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute -top-2 -right-2 bg-white border border-neutral-200 rounded-full h-7 w-7 text-sm flex items-center justify-center hover:bg-red-50 hover:text-red-600 after:absolute after:-inset-2"
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Scope */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">
            Where should makers discover this request?
          </label>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="scope"
                value="national"
                checked={scope === "national"}
                onChange={() => setScope("national")}
                className="accent-[#2C1F1A]"
              />
              <span className="text-sm">All makers nationwide</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="scope"
                value="local"
                checked={scope === "local"}
                onChange={() => setScope("local")}
                className="accent-[#2C1F1A]"
              />
              <span className="text-sm">Prioritize nearby makers</span>
            </label>
          </div>
          <p className="text-xs text-neutral-500 mt-1">
            Nearby requests are highlighted to makers near your saved location. Other makers may still see them.
          </p>
        </div>

        {/* Beside the button that caused it, so it can't be off-screen. */}
        {error && (
          <div ref={errorRef} role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="pt-2 flex gap-3">
          <button
            type="submit"
            disabled={submitting || uploading || !title.trim() || !description.trim()}
            className="btn btn-primary"
          >
            {submitting ? "Posting…" : uploading ? "Waiting for photos…" : "Post Request"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="btn btn-secondary"
          >
            Cancel
          </button>
        </div>
      </form>
    </>
  );
}
