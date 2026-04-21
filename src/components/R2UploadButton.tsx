"use client";
import * as React from "react";
import { useR2Upload, type UploadedFile } from "@/hooks/useR2Upload";

type Endpoint =
  | "listingImage" | "messageImage" | "messageFile" | "messageAny"
  | "reviewPhoto" | "listingVideo" | "bannerImage" | "galleryImage";

type Props = {
  endpoint: Endpoint;
  onClientUploadComplete?: (files: UploadedFile[]) => void;
  onUploadError?: (error: Error) => void;
  onUploadBegin?: (filename: string) => void;
  onUploadProgress?: (progress: number) => void;
  appearance?: {
    button?: string;
    container?: string;
    allowedContent?: string; // accepted for compat, not rendered
  };
  content?: {
    button?: React.ReactNode | ((props: { ready: boolean }) => React.ReactNode);
    allowedContent?: React.ReactNode; // accepted for compat, not rendered
  };
  disabled?: boolean;
};

export default function R2UploadButton({
  endpoint,
  onClientUploadComplete,
  onUploadError,
  onUploadBegin,
  onUploadProgress,
  appearance,
  content,
  disabled,
}: Props) {
  const [uploadError, setUploadError] = React.useState<string | null>(null);

  const { startUpload, isUploading, progress } = useR2Upload({
    endpoint,
    onUploadComplete: (files) => {
      setUploadError(null);
      onClientUploadComplete?.(files);
    },
    onUploadError: (err) => {
      setUploadError(err.message ?? "Upload failed. Please try a smaller file.");
      onUploadError?.(err);
    },
    onUploadBegin: (filename) => {
      setUploadError(null);
      onUploadBegin?.(filename);
    },
  });

  // Forward progress to caller if provided
  React.useEffect(() => {
    if (onUploadProgress) onUploadProgress(progress);
  }, [progress, onUploadProgress]);

  const inputRef = React.useRef<HTMLInputElement>(null);

  const multipleEndpoints = ["listingImage", "messageImage", "messageAny", "reviewPhoto", "galleryImage"];
  const multiple = multipleEndpoints.includes(endpoint);

  const acceptMap: Record<string, string> = {
    listingImage: "image/*",
    messageImage: "image/*",
    messageFile: "application/pdf",
    messageAny: "image/*,application/pdf",
    reviewPhoto: "image/*",
    listingVideo: "video/*",
    bannerImage: "image/*",
    galleryImage: "image/*",
  };

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) startUpload(files);
    e.target.value = "";
  }

  const rawButton = content?.button;
  const buttonLabel = typeof rawButton === "function"
    ? rawButton({ ready: !isUploading })
    : (rawButton ?? (isUploading ? "Uploading…" : "Upload"));

  return (
    <div className={appearance?.container}>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        multiple={multiple}
        accept={acceptMap[endpoint]}
        onChange={handleChange}
        disabled={disabled || isUploading}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || isUploading}
        className={appearance?.button ?? "rounded-md bg-neutral-900 text-white px-4 py-2 text-sm hover:bg-neutral-800 transition-colors disabled:opacity-50"}
      >
        {buttonLabel}
      </button>
      {uploadError && (
        <p className="text-xs text-red-600 mt-1">{uploadError}</p>
      )}
    </div>
  );
}
