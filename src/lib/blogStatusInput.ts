import { BlogPostStatus } from "@prisma/client";

const CREATE_STATUSES = new Set<BlogPostStatus>([
  BlogPostStatus.DRAFT,
  BlogPostStatus.PUBLISHED,
]);

const UPDATE_STATUSES = new Set<BlogPostStatus>([
  BlogPostStatus.DRAFT,
  BlogPostStatus.PUBLISHED,
  BlogPostStatus.ARCHIVED,
]);

function parseBlogStatusInput(value: FormDataEntryValue | null, allowed: Set<BlogPostStatus>) {
  const status = typeof value === "string" && value ? value : BlogPostStatus.DRAFT;
  if (allowed.has(status as BlogPostStatus)) return status as BlogPostStatus;
  return null;
}

export function parseCreateBlogStatus(value: FormDataEntryValue | null) {
  return parseBlogStatusInput(value, CREATE_STATUSES);
}

export function parseUpdateBlogStatus(value: FormDataEntryValue | null) {
  return parseBlogStatusInput(value, UPDATE_STATUSES);
}
