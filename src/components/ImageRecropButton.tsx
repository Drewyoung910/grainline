"use client";

import * as React from "react";
import ImageCropModal from "@/components/ImageCropModal";
import { useR2Upload, type UploadedFile } from "@/hooks/useR2Upload";
import { fileFromUrl } from "@/lib/imageFileFromUrl";
import { uploadedFileUrl } from "@/lib/uploadedFileUrl";
import type { UploadEndpoint } from "@/lib/uploadRules";

type Props = {
  imageUrl: string;
  /**
   * Optional pre-crop source. When provided, re-crop fetches THIS for the
   * crop modal source instead of the currently-displayed `imageUrl`, so
   * users can zoom back out to the full original frame instead of only
   * cropping within the already-cropped image. If omitted, falls back to
   * `imageUrl` (legacy behavior).
   */
  originalImageUrl?: string | null;
  endpoint: UploadEndpoint;
  cropAspect: number;
  filename: string;
  onCropped: (url: string, files: UploadedFile[]) => void;
  className?: string;
  label?: string;
};

export default function ImageRecropButton({
  imageUrl,
  originalImageUrl,
  endpoint,
  cropAspect,
  filename,
  onCropped,
  className,
  label = "Adjust crop",
}: Props) {
  const [sourceFile, setSourceFile] = React.useState<File | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { startUpload, isUploading, progress } = useR2Upload({
    endpoint,
    onUploadError: (err) => setError(err.message),
  });

  async function openCrop() {
    setError(null);
    setLoading(true);
    try {
      // Prefer the preserved pre-crop original so the user can re-frame
      // (including zooming out) instead of only cropping within an already-
      // cropped image. Falls back to imageUrl for legacy data with no
      // originalImageUrl.
      const source = originalImageUrl ?? imageUrl;
      setSourceFile(await fileFromUrl(source, filename));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this image for cropping.");
    } finally {
      setLoading(false);
    }
  }

  async function confirmCrop(blob: Blob) {
    const file = new File([blob], croppedFilename(filename), {
      type: blob.type || "image/jpeg",
      lastModified: Date.now(),
    });
    const files = await startUpload([file]);
    const url = uploadedFileUrl(files[0]);
    if (!url) {
      throw new Error("Upload failed. Please try again.");
    }
    setSourceFile(null);
    setError(null);
    onCropped(url, files);
  }

  const disabled = loading || isUploading;
  const buttonLabel = loading
    ? "Loading..."
    : isUploading
      ? `Uploading ${progress > 0 ? `${progress}%` : "..."}`
      : label;

  return (
    <>
      <button
        type="button"
        onClick={openCrop}
        disabled={disabled}
        className={className ?? "rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"}
      >
        {buttonLabel}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {sourceFile && (
        <ImageCropModal
          file={sourceFile}
          aspect={cropAspect}
          onCancel={() => setSourceFile(null)}
          onConfirm={confirmCrop}
        />
      )}
    </>
  );
}

function croppedFilename(name: string) {
  const base = name.replace(/\.[^.]+$/, "") || "image";
  return `${base}-recrop.jpg`;
}
