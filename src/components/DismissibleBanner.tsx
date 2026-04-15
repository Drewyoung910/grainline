"use client";
import { useState } from "react";

export default function DismissibleBanner({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className={`relative ${className}`}>
      {children}
      <button
        onClick={() => setDismissed(true)}
        className="absolute top-2 right-2 text-neutral-400 hover:text-neutral-600 text-lg leading-none"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
