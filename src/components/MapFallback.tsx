"use client";

import Link from "next/link";

type MapFallbackProps = {
  className?: string;
  message?: string;
  lat?: number | null;
  lng?: number | null;
  links?: Array<{ href: string; label: string }>;
};

export default function MapFallback({
  className = "h-48 w-full rounded-xl border border-neutral-200",
  message = "Map preview is unavailable on this device.",
  lat,
  lng,
  links = [],
}: MapFallbackProps) {
  const hasCoordinates = typeof lat === "number" && typeof lng === "number";
  const osmHref = hasCoordinates
    ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=12/${lat}/${lng}`
    : null;

  return (
    <div className={`${className} flex flex-col justify-center gap-2 bg-white p-4 text-sm text-neutral-700`}>
      <p className="font-medium text-neutral-900">{message}</p>
      {hasCoordinates && (
        <p className="text-xs text-neutral-500">
          Approximate coordinates: {lat.toFixed(4)}, {lng.toFixed(4)}
        </p>
      )}
      <div className="flex flex-wrap gap-3 text-xs">
        {osmHref && (
          <a href={osmHref} target="_blank" rel="noopener noreferrer" className="font-medium text-neutral-900 underline underline-offset-2 hover:text-neutral-600">
            Open in OpenStreetMap
          </a>
        )}
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="font-medium text-neutral-900 underline underline-offset-2 hover:text-neutral-600">
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
