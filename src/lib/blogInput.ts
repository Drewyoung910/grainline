import { isR2PublicUrl } from "@/lib/urlValidation";

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

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Video URL must be a valid URL.");
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const allowedHosts = new Set([
    "youtube.com",
    "m.youtube.com",
    "youtu.be",
    "youtube-nocookie.com",
    "vimeo.com",
    "player.vimeo.com",
  ]);
  if (parsed.protocol !== "https:" || !allowedHosts.has(host)) {
    throw new Error("Video URL must be a valid YouTube or Vimeo https:// URL.");
  }

  parsed.hash = "";
  return parsed.toString();
}

