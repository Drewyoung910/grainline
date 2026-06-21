import { normalizeBlogVideoUrlString } from "@/lib/blogVideo";
import { verifyFirstPartyMediaUrlForPersistence } from "@/lib/uploadPersistenceVerification";
import { IMAGE_UPLOAD_TYPES } from "@/lib/uploadRules";

function trimmed(raw: FormDataEntryValue | string | null | undefined): string | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  return value ? value : null;
}

export async function normalizeBlogCoverImageUrl(
  raw: FormDataEntryValue | string | null | undefined,
  clerkUserId: string,
  existingUrl?: string | null,
  accountUserId?: string,
): Promise<string | null> {
  const value = trimmed(raw);
  if (!value) return null;
  if (value === existingUrl) {
    return value;
  }
  const verification = await verifyFirstPartyMediaUrlForPersistence({
    url: value,
    allowedEndpoints: ["galleryImage", "blogImage"],
    clerkUserId,
    accountUserId,
    allowedContentTypes: IMAGE_UPLOAD_TYPES,
  });
  if (!verification.ok) {
    throw new Error("Cover image must be an uploaded Grainline image.");
  }
  return value;
}

export function normalizeBlogVideoUrl(raw: FormDataEntryValue | string | null | undefined): string | null {
  const value = trimmed(raw);
  if (!value) return null;
  return normalizeBlogVideoUrlString(value);
}
