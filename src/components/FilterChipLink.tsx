"use client";

import Link from "next/link";
import { X } from "@/components/icons";

// Navigate immediately. Delaying navigation for an exit animation lets two
// quick removals race and can leave an invisible, still-active filter behind.
export default function FilterChipLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={`Remove filter: ${label}`}
      onPointerUp={(event) => event.currentTarget.blur()}
      className="filter-chip-in inline-flex h-8 items-center gap-1.5 rounded-full bg-[#2C1F1A] pl-3 pr-2 text-[13.5px] text-[#FBF8F3] transition-colors hover:bg-[#45332B]"
    >
      <span className="max-w-[16rem] truncate">{label}</span>
      <X size={14} aria-hidden="true" className="shrink-0 opacity-80" />
    </Link>
  );
}
