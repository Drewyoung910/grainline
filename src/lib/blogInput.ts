import { isR2PublicUrl } from "@/lib/urlValidation";
import { normalizeBlogVideoUrlString } from "@/lib/blogVideo";

function trimmed(raw: FormDataEntryValue | string | null | undefined): string | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  return value ? value : null;
}

export function normalizeBlogCoverImageUrl(raw: FormDataEntryValue | string | null | undefined): string | null {
  const value = trimmed(raw);
  if (!value) return null;
  if (!isR2PublicUrl(value)) {
    throw new Error("Cover image must be an uploaded Grainline image.");
  }
  return value;
}

export function normalizeBlogVideoUrl(raw: FormDataEntryValue | string | null | undefined): string | null {
  const value = trimmed(raw);
  if (!value) return null;
  return normalizeBlogVideoUrlString(value);
}
