"use client";

import Link from "next/link";
import UnreadBadge from "@/components/UnreadBadge";

export default function MessageIconLink() {
  return (
    <Link
      href="/messages"
      aria-label="Messages"
      title="Messages"
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-neutral-800 hover:bg-neutral-50"
    >
      {/* Envelope icon */}
      <svg
        className="h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 7l9 6 9-6" />
      </svg>

      {/* Red unread dot */}
      <UnreadBadge />
    </Link>
  );
}


