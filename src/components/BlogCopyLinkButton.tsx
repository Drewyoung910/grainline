"use client";
import * as React from "react";
import { useToast } from "@/components/Toast";

export default function BlogCopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = React.useState(false);
  const { toast } = useToast();

  async function handleCopy() {
    try {
      if (navigator.share) {
        await navigator.share({ url });
      } else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast("Could not copy the link. Copy it from the address bar.", "error");
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="rounded-full bg-[#EFEAE0] px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-[#E3DCCB] transition-colors"
    >
      {copied ? "Copied!" : "Copy link"}
    </button>
  );
}
