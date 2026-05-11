export const IMAGE_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const DIRECT_UPLOAD_TYPES = ["video/mp4", "video/quicktime", "application/pdf"] as const;

export const UPLOAD_ENDPOINTS = [
  "listingImage",
  "messageImage",
  "messageFile",
  "messageAny",
  "reviewPhoto",
  "listingVideo",
  "bannerImage",
  "galleryImage",
] as const;

export type UploadEndpoint = (typeof UPLOAD_ENDPOINTS)[number];

export const IMAGE_UPLOAD_ENDPOINTS = [
  "listingImage",
  "messageImage",
  "messageAny",
  "reviewPhoto",
  "bannerImage",
  "galleryImage",
] as const satisfies readonly UploadEndpoint[];

export const DIRECT_UPLOAD_ENDPOINTS = [
  "listingVideo",
  "messageFile",
  "messageAny",
] as const satisfies readonly UploadEndpoint[];

export const UPLOAD_MAX_SIZES: Record<UploadEndpoint, number> = {
  listingImage: 10 * 1024 * 1024,
  messageImage: 8 * 1024 * 1024,
  messageFile: 8 * 1024 * 1024,
  messageAny: 8 * 1024 * 1024,
  reviewPhoto: 8 * 1024 * 1024,
  listingVideo: 128 * 1024 * 1024,
  bannerImage: 15 * 1024 * 1024,
  galleryImage: 8 * 1024 * 1024,
};

export const UPLOAD_MAX_COUNTS: Record<UploadEndpoint, number> = {
  listingImage: 10,
  messageImage: 6,
  messageFile: 4,
  messageAny: 6,
  reviewPhoto: 6,
  listingVideo: 1,
  bannerImage: 1,
  galleryImage: 10,
};

export const UPLOAD_ENDPOINT_LABELS: Record<UploadEndpoint, string> = {
  listingImage: "listing photo",
  messageImage: "message image",
  messageFile: "message file",
  messageAny: "message attachment",
  reviewPhoto: "review photo",
  listingVideo: "listing video",
  bannerImage: "shop banner",
  galleryImage: "gallery photo",
};

export const DIRECT_ENDPOINT_ALLOWED_TYPES: Record<UploadEndpoint, readonly string[]> = {
  listingImage: [],
  messageImage: [],
  messageFile: DIRECT_UPLOAD_TYPES,
  messageAny: [...IMAGE_UPLOAD_TYPES, ...DIRECT_UPLOAD_TYPES],
  reviewPhoto: [],
  listingVideo: ["video/mp4", "video/quicktime"],
  bannerImage: [],
  galleryImage: [],
};

export function formatUploadMegabytes(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, "");
}

export function uploadMaxSizeMb(endpoint: UploadEndpoint) {
  return formatUploadMegabytes(UPLOAD_MAX_SIZES[endpoint]);
}

export function allowedTypesLabel(endpoint: UploadEndpoint) {
  if (IMAGE_UPLOAD_ENDPOINTS.includes(endpoint as (typeof IMAGE_UPLOAD_ENDPOINTS)[number])) {
    if (endpoint === "messageAny") return "JPEG, PNG, WebP, MP4, MOV, and PDF";
    return "JPEG, PNG, and WebP images";
  }
  if (endpoint === "listingVideo") return "MP4 and MOV videos";
  if (endpoint === "messageFile") return "MP4, MOV, and PDF files";
  return "supported files";
}

export function uploadTooLargeMessage(endpoint: UploadEndpoint, actualSize: number) {
  const label = UPLOAD_ENDPOINT_LABELS[endpoint];
  return `${capitalize(label)} must be under ${uploadMaxSizeMb(endpoint)} MB. Your file is ${formatUploadMegabytes(actualSize)} MB. Try resizing or use a different file.`;
}

export function uploadTypeMessage(endpoint: UploadEndpoint, contentType: string) {
  const actual = contentType || "an unknown file type";
  return `Only ${allowedTypesLabel(endpoint)} are allowed. You uploaded ${actual}.`;
}

export function uploadExtensionMessage(contentType: string, allowedExtensions: readonly string[]) {
  const extensions = allowedExtensions.map((extension) => `.${extension}`).join(", ");
  return `File extension does not match ${contentType}. Use ${extensions}.`;
}

export function uploadTooManyFilesMessage(endpoint: UploadEndpoint) {
  const label = UPLOAD_ENDPOINT_LABELS[endpoint];
  return `Up to ${UPLOAD_MAX_COUNTS[endpoint]} ${UPLOAD_MAX_COUNTS[endpoint] === 1 ? "file" : "files"} can be uploaded for this ${label}.`;
}

export function validateUploadFile(
  endpoint: UploadEndpoint,
  file: { size: number; type: string },
  fileIndex = 0,
) {
  if (fileIndex >= UPLOAD_MAX_COUNTS[endpoint]) {
    throw new Error(uploadTooManyFilesMessage(endpoint));
  }
  if (file.size > UPLOAD_MAX_SIZES[endpoint]) {
    throw new Error(uploadTooLargeMessage(endpoint, file.size));
  }

  const imageEndpoint = IMAGE_UPLOAD_ENDPOINTS.includes(endpoint as (typeof IMAGE_UPLOAD_ENDPOINTS)[number]);
  const imageType = IMAGE_UPLOAD_TYPES.includes(file.type as (typeof IMAGE_UPLOAD_TYPES)[number]);
  const directAllowed = DIRECT_ENDPOINT_ALLOWED_TYPES[endpoint]?.includes(file.type) ?? false;

  if (imageEndpoint && imageType) return;
  if (directAllowed) return;

  throw new Error(uploadTypeMessage(endpoint, file.type));
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
