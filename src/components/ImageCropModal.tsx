"use client";

import * as React from "react";
import { createPortal } from "react-dom";

type Props = {
  file: File;
  aspect?: number;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void | Promise<void>;
};

const MAX_OUTPUT_LONG_EDGE = 2400;

export default function ImageCropModal({ file, aspect = 1, onCancel, onConfirm }: Props) {
  const [imageUrl, setImageUrl] = React.useState("");
  const [naturalSize, setNaturalSize] = React.useState({ width: 0, height: 0 });
  const [zoom, setZoom] = React.useState(1);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = React.useState<{ pointerId: number; x: number; y: number; ox: number; oy: number } | null>(null);
  const [processing, setProcessing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [mounted, setMounted] = React.useState(false);
  const frameRef = React.useRef<HTMLDivElement>(null);
  const imgRef = React.useRef<HTMLImageElement>(null);
  const displayScale = getDisplayScale(frameRef.current, naturalSize, zoom);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    const url = URL.createObjectURL(file);
    setNaturalSize({ width: 0, height: 0 });
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setDragStart(null);
    setProcessing(false);
    setError(null);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  React.useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStart({ pointerId: event.pointerId, x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y });
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    setOffset(clampOffset({
      x: dragStart.ox + event.clientX - dragStart.x,
      y: dragStart.oy + event.clientY - dragStart.y,
    }));
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (dragStart?.pointerId === event.pointerId) setDragStart(null);
  }

  function clampOffset(nextOffset: { x: number; y: number }, zoomValue = zoom) {
    const frame = frameRef.current;
    if (!frame || naturalSize.width <= 0 || naturalSize.height <= 0) return nextOffset;
    const frameRect = frame.getBoundingClientRect();
    const scale = getDisplayScale(frame, naturalSize, zoomValue);
    const scaledWidth = naturalSize.width * scale;
    const scaledHeight = naturalSize.height * scale;
    const maxX = Math.max(0, (scaledWidth - frameRect.width) / 2);
    const maxY = Math.max(0, (scaledHeight - frameRect.height) / 2);
    return {
      x: clamp(nextOffset.x, -maxX, maxX),
      y: clamp(nextOffset.y, -maxY, maxY),
    };
  }

  function handleZoomChange(value: number) {
    setZoom(value);
    setOffset((current) => clampOffset(current, value));
  }

  async function confirmCrop() {
    const frame = frameRef.current;
    const img = imgRef.current;
    if (!frame || !img || naturalSize.width <= 0 || naturalSize.height <= 0) return;
    setProcessing(true);
    setError(null);
    try {
      const frameRect = frame.getBoundingClientRect();
      const frameWidth = frameRect.width;
      const frameHeight = frameRect.height;
      const coverScale = Math.max(frameWidth / naturalSize.width, frameHeight / naturalSize.height);
      const displayScale = coverScale * zoom;
      const sourceWidth = frameWidth / displayScale;
      const sourceHeight = frameHeight / displayScale;
      const sourceCenterX = naturalSize.width / 2 - offset.x / displayScale;
      const sourceCenterY = naturalSize.height / 2 - offset.y / displayScale;
      const sx = clamp(sourceCenterX - sourceWidth / 2, 0, Math.max(0, naturalSize.width - sourceWidth));
      const sy = clamp(sourceCenterY - sourceHeight / 2, 0, Math.max(0, naturalSize.height - sourceHeight));
      const outputScale = Math.min(1, MAX_OUTPUT_LONG_EDGE / Math.max(sourceWidth, sourceHeight));
      const outputWidth = Math.max(1, Math.round(sourceWidth * outputScale));
      const outputHeight = Math.max(1, Math.round(sourceHeight * outputScale));
      const canvas = document.createElement("canvas");
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not prepare image crop.");
      // High-quality canvas resampling must be set BEFORE drawImage so the
      // downscale uses the better filter. Output JPEG at 95% quality so
      // crops (especially banners) don't lose detail vs the original upload.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, sourceWidth, sourceHeight, 0, 0, outputWidth, outputHeight);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95));
      if (!blob) throw new Error("Could not prepare image crop.");
      await onConfirm(blob);
      setProcessing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not prepare image crop.");
      setProcessing(false);
    }
  }

  // Render through a portal at document.body so any drag/pointer interaction
  // inside the modal (zoom slider, image pan) does not bubble into draggable
  // ancestors (e.g. the <li draggable> photo card in PhotoManager / EditPhotoGrid).
  if (!mounted) return null;

  const modal = (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 px-4 py-6">
      <div className="w-full max-w-2xl rounded-lg bg-[#F7F5F0] p-4 shadow-xl sm:p-5">
        <div className="mb-4">
          <h2 className="font-display text-xl font-semibold text-neutral-900">Adjust image</h2>
          <p className="mt-1 text-sm text-neutral-600">Drag to position. Zoom to choose the visible crop.</p>
        </div>

        <div
          ref={frameRef}
          className="relative mx-auto w-full max-w-xl touch-none overflow-hidden rounded-lg border border-neutral-200 bg-neutral-950"
          style={{ aspectRatio: aspect }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={imageUrl}
              alt=""
              draggable={false}
              onLoad={(event) => {
                setNaturalSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                });
              }}
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
              style={{
                width: naturalSize.width,
                height: naturalSize.height,
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${displayScale})`,
                transformOrigin: "center",
              }}
            />
          )}
        </div>

        <label className="mt-4 block text-sm font-medium text-neutral-700" htmlFor="image-crop-zoom">
          Zoom
        </label>
        <input
          id="image-crop-zoom"
          type="range"
          min="1"
          max="3"
          step="0.05"
          value={zoom}
          onChange={(event) => handleZoomChange(Number(event.target.value))}
          className="mt-2 w-full accent-neutral-900"
        />

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={processing}
            className="rounded-md border border-neutral-200 px-4 py-2 text-sm text-neutral-700 hover:bg-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmCrop}
            disabled={processing || naturalSize.width <= 0}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {processing ? "Preparing..." : "Use this crop"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getDisplayScale(
  frame: HTMLDivElement | null,
  naturalSize: { width: number; height: number },
  zoom: number,
) {
  if (!frame || naturalSize.width <= 0 || naturalSize.height <= 0) return 1;
  const frameRect = frame.getBoundingClientRect();
  const coverScale = Math.max(
    frameRect.width / Math.max(1, naturalSize.width),
    frameRect.height / Math.max(1, naturalSize.height),
  );
  return Math.max(coverScale, 0.01) * zoom;
}
