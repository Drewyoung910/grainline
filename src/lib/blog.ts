// src/lib/blog.ts
import type { BlogPostType } from "@prisma/client";

const FNV_64_OFFSET = 0xcbf29ce484222325n;
const FNV_64_PRIME = 0x100000001b3n;
const MAX_BLOG_SLUG_LENGTH = 255;
const CJK_READING_CHAR_PATTERN =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/gu;

export const BLOG_BODY_MAX_CHARS = 50_000;

function fnv64Base36(value: string): string {
  let hash = FNV_64_OFFSET;
  for (const char of value.normalize("NFC")) {
    hash ^= BigInt(char.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * FNV_64_PRIME);
  }
  return hash.toString(36);
}

export function generateSlug(title: string): string {
  const trimmed = title.trim();
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const hasNonAscii = /[^\x00-\x7F]/.test(trimmed);
  const hash = fnv64Base36(trimmed);
  if (slug) {
    if (!hasNonAscii) return slug.slice(0, MAX_BLOG_SLUG_LENGTH);
    const suffix = `-${hash}`;
    const maxBaseLength = Math.max(1, MAX_BLOG_SLUG_LENGTH - suffix.length);
    return `${slug.slice(0, maxBaseLength).replace(/-+$/g, "")}${suffix}`;
  }
  return `post-${hash}`;
}

export function calculateReadingTime(body: string): number {
  const cjkChars = body.match(CJK_READING_CHAR_PATTERN)?.length ?? 0;
  if (cjkChars > 0) {
    const latinWords = body
      .replace(CJK_READING_CHAR_PATTERN, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    return Math.max(1, Math.ceil(latinWords / 200 + cjkChars / 400));
  }

  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export const BLOG_TYPE_LABELS: Record<BlogPostType, string> = {
  STANDARD: "Article",
  MAKER_SPOTLIGHT: "Maker Spotlight",
  BEHIND_THE_BUILD: "Behind the Build",
  GIFT_GUIDE: "Gift Guide",
  WOOD_EDUCATION: "Workshop Tips",
};

export const BLOG_TYPE_COLORS: Record<BlogPostType, string> = {
  STANDARD: "bg-neutral-100 text-neutral-700",
  MAKER_SPOTLIGHT: "bg-amber-100 text-amber-800",
  BEHIND_THE_BUILD: "bg-stone-100 text-stone-800",
  GIFT_GUIDE: "bg-red-100 text-red-800",
  WOOD_EDUCATION: "bg-green-100 text-green-800",
};
