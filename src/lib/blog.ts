// src/lib/blog.ts
import type { BlogPostType } from "@prisma/client";

export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function calculateReadingTime(body: string): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export const BLOG_TYPE_LABELS: Record<BlogPostType, string> = {
  STANDARD: "Article",
  MAKER_SPOTLIGHT: "Maker Spotlight",
  BEHIND_THE_BUILD: "Behind the Build",
  GIFT_GUIDE: "Gift Guide",
  WOOD_EDUCATION: "Wood Education",
};

export const BLOG_TYPE_COLORS: Record<BlogPostType, string> = {
  STANDARD: "bg-neutral-100 text-neutral-700",
  MAKER_SPOTLIGHT: "bg-amber-100 text-amber-800",
  BEHIND_THE_BUILD: "bg-stone-100 text-stone-800",
  GIFT_GUIDE: "bg-red-100 text-red-800",
  WOOD_EDUCATION: "bg-green-100 text-green-800",
};
