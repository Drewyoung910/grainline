"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "@/components/icons";

// A removable browse filter chip: it pops in when applied (`.filter-chip-in`)
// and shrinks away before navigating to the results without it. Modified
// clicks (new tab, etc.) fall through to the plain link.
export default function FilterChipLink({ href, label }: { href: string; label: string }) {
  const router = useRouter();
  const [leaving, setLeaving] = React.useState(false);

  const onClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;
    event.preventDefault();
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(() => router.push(href), 180);
  };

  return (
    <Link
      href={href}
      onClick={onClick}
      aria-label={`Remove filter: ${label}`}
      className={`${leaving ? "filter-chip-out" : "filter-chip-in"} inline-flex h-8 items-center gap-1.5 rounded-full bg-[#2C1F1A] pl-3 pr-2 text-[13.5px] text-[#FBF8F3] transition-colors hover:bg-[#45332B]`}
    >
      <span className="max-w-[16rem] truncate">{label}</span>
      <X size={14} aria-hidden="true" className="shrink-0 opacity-80" />
    </Link>
  );
}
