export async function fileFromUrl(url: string, filename: string) {
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) {
    throw new Error("Could not load this image for cropping. Try re-uploading it instead.");
  }
  const blob = await response.blob();
  const type = blob.type || response.headers.get("content-type") || "image/jpeg";
  return new File([blob], filename, { type, lastModified: Date.now() });
}

