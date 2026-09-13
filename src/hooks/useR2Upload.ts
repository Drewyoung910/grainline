"use client";
import * as React from "react";
import {
  IMAGE_UPLOAD_ENDPOINTS,
  IMAGE_UPLOAD_TYPES,
  type UploadEndpoint,
  validateUploadFile,
} from "@/lib/uploadRules";

type Endpoint = UploadEndpoint;

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

const PROCESSED_IMAGE_TYPES = new Set<string>(IMAGE_UPLOAD_TYPES);
const IMAGE_ENDPOINTS = new Set<Endpoint>(IMAGE_UPLOAD_ENDPOINTS);

type XhrUploadOptions = {
  method: "POST" | "PUT";
  body: XMLHttpRequestBodyInit;
  headers?: Record<string, string>;
  onProgress?: (progress: number) => void;
  responseType?: "json" | "text";
};

function xhrUpload<T = unknown>(url: string, options: XhrUploadOptions): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(options.method, url);
    for (const [key, value] of Object.entries(options.headers ?? {})) {
      xhr.setRequestHeader(key, value);
    }
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !options.onProgress) return;
      options.onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      const text = xhr.responseText || "";
      let parsed: unknown = text;
      if ((options.responseType ?? "json") === "json" && text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(parsed as T);
        return;
      }
      const message = typeof parsed === "object" && parsed && "error" in parsed
        ? String((parsed as { error?: unknown }).error)
        : "Upload failed before it reached Grainline. Try a smaller file or a supported format.";
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("Upload failed before it reached Grainline. Check the file size and try again."));
    xhr.ontimeout = () => reject(new Error("Upload timed out. Try a smaller file or a stronger connection."));
    xhr.send(options.body);
  });
}

const routeBodyRiskThreshold = 4 * 1024 * 1024;

async function shrinkLargeImageForRouteUpload(file: File) {
  if (!PROCESSED_IMAGE_TYPES.has(file.type) || file.size <= routeBodyRiskThreshold) return file;

  const imageUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(imageUrl);
    const candidates = [
      { longEdge: 2000, quality: 0.9 },
      { longEdge: 1800, quality: 0.86 },
      { longEdge: 1600, quality: 0.82 },
      { longEdge: 1400, quality: 0.78 },
      { longEdge: 1200, quality: 0.74 },
      { longEdge: 1000, quality: 0.7 },
      { longEdge: 800, quality: 0.68 },
    ];
    let bestBlob: Blob | null = null;
    for (const candidate of candidates) {
      const blob = await renderImageToJpeg(image, candidate.longEdge, candidate.quality);
      if (!blob) continue;
      if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
      if (blob.size <= routeBodyRiskThreshold) {
        return new File([blob], compressedFilename(file.name), {
          type: "image/jpeg",
          lastModified: Date.now(),
        });
      }
    }
    if (!bestBlob || bestBlob.size >= file.size) return file;
    return new File([bestBlob], compressedFilename(file.name), {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

async function renderImageToJpeg(image: HTMLImageElement, longEdge: number, quality: number) {
  const longest = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = Math.min(1, longEdge / Math.max(1, longest));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, width, height);
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read this image. Try a JPEG, PNG, or WebP file."));
    image.src = url;
  });
}

function compressedFilename(name: string) {
  const base = name.replace(/\.[^.]+$/, "") || "image";
  return `${base}-optimized.jpg`;
}

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
        const originalFile = files[i];
        validateUploadFile(endpoint, originalFile, i);
        onUploadBegin?.(originalFile.name);
        let file = originalFile;
        if (PROCESSED_IMAGE_TYPES.has(file.type) && IMAGE_ENDPOINTS.has(endpoint)) {
          file = await shrinkLargeImageForRouteUpload(file);
          validateUploadFile(endpoint, file, i);
        }
        const setFileProgress = (fileProgress: number) => {
          const bounded = Math.max(0, Math.min(100, fileProgress));
          setProgress(Math.round(((i + bounded / 100) / files.length) * 100));
        };

        if (PROCESSED_IMAGE_TYPES.has(file.type) && IMAGE_ENDPOINTS.has(endpoint)) {
          const form = new FormData();
          form.set("file", file);
          form.set("endpoint", endpoint);
          form.set("fileIndex", String(i));

          const imageResult = await xhrUpload<{
            publicUrl: string;
            key: string;
            contentType?: string;
            size?: number;
          }>("/api/upload/image", {
            method: "POST",
            body: form,
            onProgress: setFileProgress,
          });

          const { publicUrl, key, contentType, size } = imageResult;

          uploaded.push({
            url: publicUrl,
            ufsUrl: publicUrl,
            key,
            name: file.name,
            type: contentType ?? file.type,
            size: size ?? file.size,
          });

          setProgress(Math.round(((i + 1) / files.length) * 100));
          continue;
        }

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

        const {
          presignedUrl,
          publicUrl,
          key,
          contentType,
          expectedSize,
          verificationToken,
          verificationExpiresAt,
        } = await res.json() as {
          presignedUrl: string;
          publicUrl: string;
          key: string;
          contentType: string;
          expectedSize: number;
          verificationToken: string;
          verificationExpiresAt: number;
        };

        await xhrUpload(presignedUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
          onProgress: setFileProgress,
          responseType: "text",
        });

        const verifyRes = await fetch("/api/upload/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key,
            endpoint,
            expectedSize,
            contentType,
            verificationToken,
            verificationExpiresAt,
          }),
        });
        if (!verifyRes.ok) {
          const err = await verifyRes.json().catch(() => ({ error: "Upload verification failed" }));
          throw new Error((err as { error?: string }).error ?? "Upload verification failed");
        }

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
