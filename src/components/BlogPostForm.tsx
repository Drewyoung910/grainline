"use client";
import * as React from "react";
import UploadButton from "@/components/R2UploadButton";
import { BLOG_TYPE_LABELS, generateSlug } from "@/lib/blog";
import MarkdownToolbar from "./MarkdownToolbar";
import ActionForm, { SubmitButton } from "@/components/ActionForm";
import { emitToast } from "@/components/Toast";
import { uploadedFileUrl } from "@/lib/uploadedFileUrl";
import type { BlogPostType } from "@prisma/client";

const STAFF_TYPES: BlogPostType[] = ["STANDARD", "MAKER_SPOTLIGHT", "BEHIND_THE_BUILD", "GIFT_GUIDE", "WOOD_EDUCATION"];
const MAKER_TYPES: BlogPostType[] = ["STANDARD", "BEHIND_THE_BUILD"];
const inputClass =
  "w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm";
const selectClass =
  "rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm";
const checkboxClass =
  "h-4 w-4 rounded border-neutral-300 text-neutral-900 accent-neutral-900 focus:ring-neutral-300";

type Listing = { id: string; title: string };

type Props = {
  action: (prevState: unknown, formData: FormData) => Promise<{ ok: boolean; error?: string }>;
  isStaff: boolean;
  listings: Listing[];
  submitLabel?: string;
  defaultValues?: {
    title?: string;
    type?: BlogPostType;
    coverImageUrl?: string;
    videoUrl?: string;
    body?: string;
    materialDisclosure?: string;
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
  const [materialDisclosure, setMaterialDisclosure] = React.useState(defaultValues.materialDisclosure ?? "");
  const [excerpt, setExcerpt] = React.useState(defaultValues.excerpt ?? "");
  const [metaDescription, setMetaDescription] = React.useState(defaultValues.metaDescription ?? "");

  const allowedTypes = isStaff ? STAFF_TYPES : MAKER_TYPES;

  // Derive slug preview
  const slugPreview = title.trim() ? generateSlug(title) : "your-post-slug";

  return (
    <ActionForm action={action} className="space-y-6">
      {/* Title */}
      <div className="space-y-1">
        <label className="block text-sm font-medium">Title <span className="text-red-500">*</span></label>
        <input
          name="title"
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
          placeholder="Enter post title"
        />
        <p className="text-xs text-neutral-500">Slug preview: <code className="bg-neutral-100 px-1 rounded">/blog/{slugPreview}</code></p>
      </div>

      {/* Type */}
      <div className="space-y-1">
        <label className="block text-sm font-medium">Post type</label>
        <select
          name="type"
          defaultValue={defaultValues.type ?? "STANDARD"}
          className={selectClass}
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
            <img src={coverImageUrl} alt="Cover" className="h-40 w-64 rounded-md border border-neutral-200 object-cover" />
            <button
              type="button"
              onClick={() => setCoverImageUrl("")}
              className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 bg-white text-xs hover:bg-red-50"
              aria-label="Remove cover image"
            >
              ×
            </button>
          </div>
        ) : (
          <UploadButton
            endpoint="blogImage"
            allowMultiple={false}
            appearance={{
              button: "rounded-md bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-700",
              container: "inline-block",
              allowedContent: "hidden",
            }}
            content={{ button: ({ ready }) => ready ? "Upload cover image" : "Preparing…" }}
            onClientUploadComplete={(files) => {
              const url = uploadedFileUrl(files[0]);
              if (url) setCoverImageUrl(url);
            }}
            onUploadError={(err) => emitToast(err?.message || "Cover upload failed.", "error")}
          />
        )}
      </div>

      {/* Video URL */}
      <div className="space-y-1">
        <label className="block text-sm font-medium">Video URL <span className="text-neutral-500 font-normal">(optional)</span></label>
        <input
          name="videoUrl"
          type="url"
          defaultValue={defaultValues.videoUrl ?? ""}
          placeholder="YouTube or Vimeo URL"
          className={inputClass}
        />
      </div>

      {/* Body */}
      <div className="space-y-1">
        <label className="block text-sm font-medium">Body <span className="text-red-500">*</span></label>
        <MarkdownToolbar
          key={defaultValues.body ?? "new"}
          value={body}
          onChange={setBody}
          name="body"
          placeholder="Write your post..."
        />
        <p className="text-xs text-neutral-500">
          Use the toolbar to format text. Bold, headings, and lists appear as you type.{" "}
          <a href="https://www.markdownguide.org/cheat-sheet/" target="_blank" rel="noopener noreferrer" className="underline">
            Markdown syntax ↗
          </a>{" "}
          directly. Click Preview to see how it will look.
        </p>
      </div>

      {/* Material disclosure */}
      <div className="space-y-1">
        <label className="block text-sm font-medium">Material connection disclosure <span className="text-neutral-500 font-normal">(if applicable)</span></label>
        <textarea
          name="materialDisclosure"
          rows={3}
          maxLength={500}
          value={materialDisclosure}
          onChange={(e) => setMaterialDisclosure(e.target.value)}
          placeholder="Disclose sponsored tools, free materials, affiliate relationships, or other compensation."
          className={inputClass}
        />
        <p className="text-xs text-neutral-500">{materialDisclosure.length}/500</p>
      </div>

      {/* Excerpt */}
      <div className="space-y-1">
        <label className="block text-sm font-medium">Excerpt <span className="text-neutral-500 font-normal">(max 200 chars)</span></label>
        <textarea
          name="excerpt"
          rows={3}
          maxLength={200}
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          placeholder="Short summary shown in blog listings"
          className={inputClass}
        />
        <p className="text-xs text-neutral-500">{excerpt.length}/200</p>
      </div>

      {/* Meta description */}
      <div className="space-y-1">
        <label className="block text-sm font-medium">Meta description <span className="text-neutral-500 font-normal">(max 160 chars)</span></label>
        <input
          name="metaDescription"
          type="text"
          maxLength={160}
          value={metaDescription}
          onChange={(e) => setMetaDescription(e.target.value)}
          placeholder="SEO description (defaults to excerpt if blank)"
          className={inputClass}
        />
        <p className="text-xs text-neutral-500">{metaDescription.length}/160</p>
      </div>

      {/* Tags */}
      <div className="space-y-1">
        <label className="block text-sm font-medium">Tags <span className="text-neutral-500 font-normal">(comma-separated)</span></label>
        <input
          name="tags"
          type="text"
          defaultValue={defaultValues.tags ?? ""}
          placeholder="e.g. walnut, dining table, finishing"
          className={inputClass}
        />
      </div>

      {/* Featured listings */}
      {listings.length > 0 && (
        <div className="space-y-2">
          <label className="block text-sm font-medium">Feature listings in this post</label>
          <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-md border border-neutral-200 bg-white p-3">
            {listings.map((l) => (
              <label key={l.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  name="featuredListingIds"
                  value={l.id}
                  defaultChecked={defaultValues.featuredListingIds?.includes(l.id)}
                  className={checkboxClass}
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
          className={selectClass}
        >
          <option value="DRAFT">Draft</option>
          <option value="PUBLISHED">Published</option>
          <option value="ARCHIVED">Archived</option>
        </select>
      </div>

      <SubmitButton className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-60">
        {submitLabel}
      </SubmitButton>
    </ActionForm>
  );
}
