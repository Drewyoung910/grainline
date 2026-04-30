// src/app/commission/new/page.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CATEGORY_LABELS, CATEGORY_VALUES } from "@/lib/categories";
import UploadButton from "@/components/R2UploadButton";
import { emitToast } from "@/components/Toast";
import { uploadedFileUrls } from "@/lib/uploadedFileUrl";

export default function NewCommissionPage() {
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
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;
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
          budgetMin: budgetMin ? parseFloat(budgetMin) : undefined,
          budgetMax: budgetMax ? parseFloat(budgetMax) : undefined,
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
      router.push("/commission");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 pb-16 pt-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">Post a Commission Request</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Describe the custom piece you&apos;re looking for. Interested makers will reach out to discuss.
        </p>
      </div>

      {error && (
        <div className="border border-red-200 bg-red-50 text-red-700 text-sm p-3 mb-5">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            value={title}
            autoComplete="off"
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            placeholder="e.g. Custom walnut dining table for 8"
            className="w-full border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
            required
          />
          <p className="text-xs text-neutral-500 mt-1">{title.length}/100</p>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            Description <span className="text-red-500">*</span>
          </label>
          <textarea
            value={description}
            autoComplete="off"
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
            rows={5}
            placeholder="Describe dimensions, wood type preferences, style, finish, any special requirements..."
            className="w-full border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300 resize-y"
            required
          />
          <p className="text-xs text-neutral-500 mt-1">{description.length}/1000</p>
        </div>

        {/* Category */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Category (optional)</label>
          <select
            value={category}
            autoComplete="off"
            onChange={(e) => setCategory(e.target.value)}
            className="w-full border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
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
                type="number"
                autoComplete="off"
                value={budgetMin}
                onChange={(e) => setBudgetMin(e.target.value)}
                min="0"
                placeholder="Min"
                className="w-full border border-neutral-300 pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
              />
            </div>
            <span className="text-neutral-500 text-sm">to</span>
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">$</span>
              <input
                type="number"
                autoComplete="off"
                value={budgetMax}
                onChange={(e) => setBudgetMax(e.target.value)}
                min="0"
                placeholder="Max"
                className="w-full border border-neutral-300 pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
              />
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Timeline (optional)</label>
          <input
            value={timeline}
            autoComplete="off"
            onChange={(e) => setTimeline(e.target.value)}
            maxLength={100}
            placeholder="e.g. Within 3 months, flexible"
            className="w-full border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
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
              endpoint="listingImage"
              appearance={{
                button: "bg-neutral-900 text-white text-xs px-3 py-2 hover:bg-neutral-700",
                container: "inline-block",
                allowedContent: "hidden",
              }}
              content={{ button: ({ ready }) => (ready ? "Upload photos" : "Preparing…") }}
              onClientUploadComplete={(files) => {
                const newUrls = uploadedFileUrls(files);
                setReferenceImageUrls((prev) => [...prev, ...newUrls].slice(0, 3));
              }}
              onUploadError={(e) => emitToast(e.message || "Upload failed", "error")}
            />
          )}
          {referenceImageUrls.length > 0 && (
            <div className="flex gap-2 mt-2 flex-wrap">
              {referenceImageUrls.map((url, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="w-16 h-16 object-cover border border-neutral-200" />
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
            Who can see this request?
          </label>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="scope"
                value="national"
                checked={scope === "national"}
                onChange={() => setScope("national")}
                className="accent-neutral-900"
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
                className="accent-neutral-900"
              />
              <span className="text-sm">Local makers only</span>
            </label>
          </div>
          <p className="text-xs text-neutral-500 mt-1">
            Local shows your request to makers within ~50 miles of your location (requires location set in your account)
          </p>
        </div>

        <div className="pt-2 flex gap-3">
          <button
            type="submit"
            disabled={submitting || !title.trim() || !description.trim()}
            className="bg-neutral-900 text-white px-6 py-2.5 text-sm hover:bg-neutral-700 transition-colors disabled:opacity-50"
          >
            {submitting ? "Posting…" : "Post Request"}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="border border-neutral-300 px-6 py-2.5 text-sm hover:bg-neutral-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </main>
  );
}
