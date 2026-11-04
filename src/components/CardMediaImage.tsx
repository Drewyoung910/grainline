"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

type Props = {
  src?: string | null;
  fallbackSrc?: string | null;
  alt: string;
  sizes: string;
  className: string;
  fallbackClassName: string;
  loading?: "eager" | "lazy";
  ariaHidden?: boolean;
  dataCardPhoto?: boolean;
  dataPhotoState?: string;
  dataReady?: boolean;
  onLoad?: () => void;
  onError?: () => void;
};

const publicR2Origin = (() => {
  const value = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? process.env.NEXT_PUBLIC_CLOUDFLARE_R2_PUBLIC_URL;
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
})();

function canUseImageOptimizer(src: string) {
  if (src.startsWith("/")) return true;
  try {
    const url = new URL(src);
    return url.hostname === "cdn.thegrainline.com" || url.origin === publicR2Origin;
  } catch {
    return false;
  }
}

/**
 * Responsive card media for the catalogue's densest surfaces. Current R2
 * assets go through Next's optimizer and receive a viewport-sized srcset;
 * legacy UploadThing URLs retain the raw-image fallback instead of breaking.
 */
export default function CardMediaImage({
  src,
  fallbackSrc,
  alt,
  sizes,
  className,
  fallbackClassName,
  loading = "lazy",
  ariaHidden = false,
  dataCardPhoto = false,
  dataPhotoState,
  dataReady,
  onLoad,
  onError,
}: Props) {
  const initialSrc = src ?? fallbackSrc ?? null;
  const usableFallback = fallbackSrc && fallbackSrc !== src ? fallbackSrc : null;
  const [currentSrc, setCurrentSrc] = useState<string | null>(initialSrc);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setCurrentSrc(src ?? fallbackSrc ?? null);
    setFailed(false);
  }, [src, fallbackSrc]);

  const optimized = useMemo(() => (currentSrc ? canUseImageOptimizer(currentSrc) : false), [currentSrc]);

  const handleError = () => {
    if (usableFallback && currentSrc !== usableFallback) {
      setCurrentSrc(usableFallback);
      setFailed(false);
      return;
    }
    setFailed(true);
    onError?.();
  };

  if (!currentSrc || failed) {
    return <div aria-hidden="true" className={fallbackClassName} />;
  }

  const dataProps = {
    ...(dataCardPhoto ? { "data-card-photo": "" } : {}),
    ...(dataPhotoState ? { "data-photo-state": dataPhotoState } : {}),
    ...(dataReady !== undefined ? { "data-ready": dataReady ? "true" : "false" } : {}),
  };

  if (optimized) {
    return (
      <Image
        src={currentSrc}
        alt={alt}
        fill
        sizes={sizes}
        loading={loading}
        aria-hidden={ariaHidden || undefined}
        className={className}
        onLoad={onLoad}
        onError={handleError}
        {...dataProps}
      />
    );
  }

  return (
    // Legacy UploadThing media is outside the current optimizer allowlist.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={currentSrc}
      alt={alt}
      loading={loading}
      aria-hidden={ariaHidden || undefined}
      className={className}
      onLoad={onLoad}
      onError={handleError}
      {...dataProps}
    />
  );
}
