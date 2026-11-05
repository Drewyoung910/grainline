export const IMAGE_FILE_FROM_URL_TIMEOUT_MS = 10_000;

export async function fileFromUrl(
  url: string,
  filename: string,
  timeoutMs = IMAGE_FILE_FROM_URL_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { mode: "cors", signal: controller.signal });
    if (!response.ok) throw new Error(`Image fetch returned ${response.status}`);
    const blob = await response.blob();
    const type = blob.type || response.headers.get("content-type") || "image/jpeg";
    return new File([blob], filename, { type, lastModified: Date.now() });
  } catch {
    // A network or CORS failure surfaces as a raw "Failed to fetch".
    throw new Error("Could not load this image for cropping. Try re-uploading it instead.");
  } finally {
    clearTimeout(timeout);
  }
}
