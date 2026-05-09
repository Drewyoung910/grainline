"use client";
import * as React from "react";
import { useR2Upload, type UploadedFile } from "@/hooks/useR2Upload";
import ImageCropModal from "@/components/ImageCropModal";
import { validateUploadFile } from "@/lib/uploadRules";

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
  cropAspect?: number;
  allowMultiple?: boolean;
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
  cropAspect,
  allowMultiple,
}: Props) {
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [cropState, setCropState] = React.useState<{
    files: File[];
    cropped: File[];
    index: number;
  } | null>(null);

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
  const multiple = allowMultiple ?? multipleEndpoints.includes(endpoint);

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
    if (files.length > 0) {
      try {
        files.forEach((file, index) => validateUploadFile(endpoint, file, index));
      } catch (error) {
        const err = error instanceof Error ? error : new Error("Upload failed");
        setUploadError(err.message);
        onUploadError?.(err);
        e.target.value = "";
        return;
      }

      if (cropAspect && files.every((file) => file.type.startsWith("image/"))) {
        setUploadError(null);
        setCropState({ files, cropped: [], index: 0 });
      } else {
        void startUpload(files);
      }
    }
    e.target.value = "";
  }

  function finishCrop(blob: Blob) {
    if (!cropState) return;
    const source = cropState.files[cropState.index];
    const croppedFile = new File([blob], croppedFilename(source.name), {
      type: blob.type || "image/jpeg",
      lastModified: Date.now(),
    });
    const cropped = [...cropState.cropped, croppedFile];
    const nextIndex = cropState.index + 1;
    if (nextIndex < cropState.files.length) {
      setCropState({ files: cropState.files, cropped, index: nextIndex });
      return;
    }
    setCropState(null);
    void startUpload(cropped);
  }

  function cancelCrop() {
    setCropState(null);
  }

  const rawButton = content?.button;
  const configuredButtonLabel = typeof rawButton === "function"
    ? rawButton({ ready: !isUploading })
    : (rawButton ?? (isUploading ? "Uploading…" : "Upload"));
  const buttonLabel = isUploading
    ? `Uploading ${progress > 0 ? `${progress}%` : "…"}`
    : configuredButtonLabel;

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
        <span className="inline-flex items-center justify-center gap-2">
          {isUploading && (
            <span
              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
              aria-hidden="true"
            />
          )}
          {buttonLabel}
        </span>
      </button>
      {uploadError && (
        <p className="text-xs text-red-600 mt-1">{uploadError}</p>
      )}
      {cropState && (
        <ImageCropModal
          file={cropState.files[cropState.index]}
          aspect={cropAspect}
          onCancel={cancelCrop}
          onConfirm={finishCrop}
        />
      )}
    </div>
  );
}

function croppedFilename(name: string) {
  const base = name.replace(/\.[^.]+$/, "") || "image";
  return `${base}-crop.jpg`;
}
