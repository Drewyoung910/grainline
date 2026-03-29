"use client";
import * as React from "react";

export default function BlogCopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = React.useState(false);

  async function handleCopy() {
    try {
      if (navigator.share) {
        await navigator.share({ url });
      } else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // fallback: do nothing
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="rounded-full border px-3 py-1.5 text-xs font-medium hover:bg-neutral-50"
    >
      {copied ? "Copied!" : "Copy link"}
    </button>
  );
}
