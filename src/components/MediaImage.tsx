"use client";

import * as React from "react";

type Props = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src?: string | null;
  fallbackSrc?: string | null;
  fallbackClassName?: string;
};

export default function MediaImage({
  src,
  fallbackSrc,
  alt,
  className,
  fallbackClassName,
  onError,
  ...props
}: Props) {
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [currentSrc, setCurrentSrc] = React.useState<string | null>(() => src ?? fallbackSrc ?? null);
  const usableFallbackSrc = fallbackSrc && fallbackSrc !== src ? fallbackSrc : null;

  React.useEffect(() => {
    setFailed(false);
    setCurrentSrc(src ?? fallbackSrc ?? null);
  }, [src, fallbackSrc]);

  const handleFailedImage = React.useCallback(() => {
    if (usableFallbackSrc && currentSrc !== usableFallbackSrc) {
      setCurrentSrc(usableFallbackSrc);
      setFailed(false);
      return;
    }
    setFailed(true);
  }, [currentSrc, usableFallbackSrc]);

  React.useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete && img.naturalWidth === 0) {
      handleFailedImage();
    }
  }, [currentSrc, handleFailedImage]);

  if (!currentSrc || failed) {
    return (
      <div
        aria-hidden="true"
        className={fallbackClassName ?? className}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      {...props}
      src={currentSrc}
      alt={alt ?? ""}
      className={className}
      onError={(event) => {
        handleFailedImage();
        onError?.(event);
      }}
    />
  );
}
