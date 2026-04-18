"use client";
import * as React from "react";
import { UploadButton } from "@/utils/uploadthing";
import { BLOG_TYPE_LABELS } from "@/lib/blog";
import MarkdownToolbar from "./MarkdownToolbar";
import type { BlogPostType } from "@prisma/client";

const STAFF_TYPES: BlogPostType[] = ["STANDARD", "MAKER_SPOTLIGHT", "BEHIND_THE_BUILD", "GIFT_GUIDE", "WOOD_EDUCATION"];
const MAKER_TYPES: BlogPostType[] = ["STANDARD", "BEHIND_THE_BUILD"];

type Listing = { id: string; title: string };

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  isStaff: boolean;
  listings: Listing[];
  submitLabel?: string;
  defaultValues?: {
    title?: string;
    type?: BlogPostType;
    coverImageUrl?: string;
    videoUrl?: string;
    body?: string;
    excerpt?: string;
    metaDescription?: string;
    tags?: string;
    featuredListingIds?: string[];
    status?: string;
  };
};

export default function BlogPostForm({ action, isStaff, listings, submitLabel = "Save", defaultValues = {} }: Props) {
  const [title, setTitle] = React.useState(defaultValues.title ?? "");
  const [coverImageUrl, setCoverImageUrl] = React.useState(defaultValues.coverImageUrl ?? "");
  const [body, setBody] = React.useState(defaultValues.body ?? "");
  const [excerpt, setExcerpt] = React.useState(defaultValues.excerpt ?? "");
  const [metaDescription, setMetaDescription] = React.useState(defaultValues.metaDescription ?? "");

  const allowedTypes = isStaff ? STAFF_TYPES : MAKER_TYPES;

  // Derive slug preview
  const slugPreview = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "your-post-slug";

  return (
    <form action={action} className="space-y-6">
      {/* Title */}
      <div className="space-y-1">
        <label className="block text-sm font-medium">Title <span className="text-red-500">*</span></label>
        <input
          name="title"
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
          placeholder="Enter post title"
        />
        <p className="text-xs text-neutral-400">Slug preview: <code className="bg-neutral-100 px-1 rounded">/blog/{slugPreview}</code></p>
      </div>

      {/* Type */}
      <div className="space-y-1">
        <label className="block text-sm font-medium">Post type</label>
        <select
          name="type"
          defaultValue={defaultValues.type ?? "STANDARD"}
          className="rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
        >
          {allowedTypes.map((t) => (
            <option key={t} value={t}>{BLOG_TYPE_LABELS[t]}</option>
          ))}
        </select>
      </div>

      {/* Cover image */}
      <div className="space-y-1">
        <label className="block text-sm font-medium">Cover image</label>
        <input type="hidden" name="coverImageUrl" value={coverImageUrl} />
        {coverImageUrl ? (
          <div className="relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={coverImageUrl} alt="Cover" className="h-40 w-64 object-cover rounded-lg border" />
            <button
              type="button"
              onClick={() => setCoverImageUrl("")}
              className="absolute top-1 right-1 rounded-full bg-white border px-1.5 text-xs hover:bg-red-50"
            >
              ✕
            </button>
          </div>
        ) : (
          <UploadButton
            endpoint="galleryImage"
            appearance={{
              button: "bg-neutral-900 text-white rounded px-3 py-2 text-sm hover:bg-neutral-700",
              container: "inline-block",
              allowedContent: "hidden",
            }}
            content={{ button: ({ ready }) => ready ? "Upload cover image" : "Preparing…" }}
            onClientUploadComplete={(files) => {
              const url = (files[0] as { ufsUrl?: string })?.ufsUrl ?? "";
              if (url) setCoverImageUrl(url);
            }}
            onUploadError={(err) => console.error("Upload error:", err)}
          />
        )}
      </div>

      {/* Video URL */}
      <div className="space-y-1">
        <label className="block text-sm font-medium">Video URL <span className="text-neutral-400 font-normal">(optional)</span></label>
        <input
          name="videoUrl"
          type="url"
          defaultValue={defaultValues.videoUrl ?? ""}
          placeholder="YouTube or Vimeo URL"
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
        />
      </div>

      {/* Body */}
      <div className="space-y-1">
        <label className="block text-sm font-medium">Body <span className="text-red-500">*</span></label>
        <MarkdownToolbar
          value={body}
          onChange={setBody}
          name="body"
          placeholder="Write your post..."
          required
        />
        <p className="text-xs text-neutral-400">
          Use the toolbar to format, or type{" "}
          <a href="https://www.markdownguide.org/cheat-sheet/" target="_blank" rel="noopener noreferrer" className="underline">
            Markdown syntax ↗
          </a>{" "}
          directly. Click Preview to see how it will look.
        </p>
      </div>

      {/* Excerpt */}
      <div className="space-y-1">
        <label className="block text-sm font-medium">Excerpt <span className="text-neutral-400 font-normal">(max 200 chars)</span></label>
        <textarea
          name="excerpt"
          rows={3}
          maxLength={200}
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          placeholder="Short summary shown in blog listings"
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
        />
        <p className="text-xs text-neutral-400">{excerpt.length}/200</p>
      </div>

      {/* Meta description */}
      <div className="space-y-1">
        <label className="block text-sm font-medium">Meta description <span className="text-neutral-400 font-normal">(max 160 chars)</span></label>
        <input
          name="metaDescription"
          type="text"
          maxLength={160}
          value={metaDescription}
          onChange={(e) => setMetaDescription(e.target.value)}
          placeholder="SEO description (defaults to excerpt if blank)"
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
        />
        <p className="text-xs text-neutral-400">{metaDescription.length}/160</p>
      </div>

      {/* Tags */}
      <div className="space-y-1">
        <label className="block text-sm font-medium">Tags <span className="text-neutral-400 font-normal">(comma-separated)</span></label>
        <input
          name="tags"
          type="text"
          defaultValue={defaultValues.tags ?? ""}
          placeholder="e.g. walnut, dining table, finishing"
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
        />
      </div>

      {/* Featured listings */}
      {listings.length > 0 && (
        <div className="space-y-2">
          <label className="block text-sm font-medium">Feature listings in this post</label>
          <div className="space-y-1.5 max-h-48 overflow-y-auto border rounded-lg p-3">
            {listings.map((l) => (
              <label key={l.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  name="featuredListingIds"
                  value={l.id}
                  defaultChecked={defaultValues.featuredListingIds?.includes(l.id)}
                  className="rounded"
                />
                {l.title}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Status */}
      <div className="space-y-1">
        <label className="block text-sm font-medium">Status</label>
        <select
          name="status"
          defaultValue={defaultValues.status ?? "DRAFT"}
          className="rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
        >
          <option value="DRAFT">Draft</option>
          <option value="PUBLISHED">Published</option>
          <option value="ARCHIVED">Archived</option>
        </select>
      </div>

      <button
        type="submit"
        className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700"
      >
        {submitLabel}
      </button>
    </form>
  );
}
