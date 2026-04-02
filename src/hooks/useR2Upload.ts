"use client";
import * as React from "react";

type Endpoint =
  | "listingImage" | "messageImage" | "messageFile" | "messageAny"
  | "reviewPhoto" | "listingVideo" | "bannerImage" | "galleryImage";

// ufsUrl is an alias for url — existing components access file.ufsUrl
export type UploadedFile = {
  url: string;
  ufsUrl: string; // alias for url — required for backward compatibility
  key: string;
  name: string;
  type: string;
  size: number;
};

type UseR2UploadOptions = {
  endpoint: Endpoint;
  onUploadComplete?: (files: UploadedFile[]) => void;
  onUploadError?: (error: Error) => void;
  onUploadBegin?: (filename: string) => void;
};

export function useR2Upload({
  endpoint,
  onUploadComplete,
  onUploadError,
  onUploadBegin,
}: UseR2UploadOptions) {
  const [isUploading, setIsUploading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);

  const startUpload = React.useCallback(async (files: File[]) => {
    setIsUploading(true);
    setProgress(0);
    const uploaded: UploadedFile[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        onUploadBegin?.(file.name);

        const res = await fetch("/api/upload/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type,
            size: file.size,
            endpoint,
            fileIndex: i,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Upload failed" }));
          throw new Error((err as { error?: string }).error ?? "Failed to get upload URL");
        }

        const { presignedUrl, publicUrl, key } = await res.json() as {
          presignedUrl: string;
          publicUrl: string;
          key: string;
        };

        const uploadRes = await fetch(presignedUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });

        if (!uploadRes.ok) throw new Error("Upload to R2 failed");

        uploaded.push({
          url: publicUrl,
          ufsUrl: publicUrl,
          key,
          name: file.name,
          type: file.type,
          size: file.size,
        });

        setProgress(Math.round(((i + 1) / files.length) * 100));
      }

      onUploadComplete?.(uploaded);
      return uploaded;
    } catch (e) {
      const err = e instanceof Error ? e : new Error("Upload failed");
      onUploadError?.(err);
      return [];
    } finally {
      setIsUploading(false);
    }
  }, [endpoint, onUploadBegin, onUploadComplete, onUploadError]);

  return { startUpload, isUploading, progress };
}
