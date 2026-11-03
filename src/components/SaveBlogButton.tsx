"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";

type Props = {
  slug: string;
  initialSaved: boolean;
};

export default function SaveBlogButton({ slug, initialSaved }: Props) {
  const router = useRouter();
  const [saved, setSaved] = React.useState(initialSaved);
  const [loading, setLoading] = React.useState(false);
  const { toast } = useToast();

  async function toggle() {
    if (loading) return;
    setLoading(true);
    const method = saved ? "DELETE" : "POST";
    try {
      const res = await fetch(`/api/blog/${slug}/save`, { method });
      if (res.status === 401) {
        router.push(`/sign-in?redirect_url=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      if (res.ok) {
        const data = (await res.json()) as { saved: boolean; error?: string };
        setSaved(data.saved);
        return;
      }
      let message = "Couldn’t update saved post.";
      try {
        const data = (await res.json()) as { error?: string };
        if (data.error) message = data.error;
      } catch {
        // keep generic message
      }
      toast(message, "error");
    } catch {
      toast("Network error. Please try again.", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={toggle}
      aria-busy={loading || undefined}
      title={saved ? "Remove from saved" : "Save post"}
      aria-label={saved ? "Remove from saved" : "Save post"}
      data-saved={saved ? "true" : "false"}
      className="listing-save-control group/blog-save relative inline-flex h-11 w-11 transform-gpu items-center justify-center rounded-full transition-[opacity,translate,scale] duration-200 ease-out focus-visible:outline-none"
    >
      <span
        aria-hidden="true"
        className="absolute h-9 w-9 rounded-full bg-white/95 shadow-[0_5px_16px_-7px_rgba(0,0,0,0.55)] ring-1 ring-black/10 transition-[background-color,scale] duration-150 ease-out group-hover/blog-save:bg-white motion-safe:group-active/blog-save:scale-[0.92] group-focus-visible/blog-save:ring-2 group-focus-visible/blog-save:ring-neutral-900 group-focus-visible/blog-save:ring-offset-2 group-focus-visible/blog-save:ring-offset-white"
      />
      {/* Match FavoriteButton geometry so the two card actions stay visually
          stable and share the same hover/focus reveal treatment. */}
      {saved ? (
        // Filled bookmark remains visible even when the card is not hovered.
        <svg
          width={18}
          height={18}
          viewBox="0 0 24 24"
          fill="#F59E0B"
          stroke="#D97706"
          strokeWidth={1}
          className="relative block transform-gpu"
        >
          <path d="M5 3a2 2 0 0 0-2 2v16l9-4 9 4V5a2 2 0 0 0-2-2H5z" />
        </svg>
      ) : (
        // Unsaved bookmark sits on the same white surface as listing hearts.
        <svg
          width={18}
          height={18}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#171717"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="relative block transform-gpu"
        >
          <path d="M5 3a2 2 0 0 0-2 2v16l9-4 9 4V5a2 2 0 0 0-2-2H5z" />
        </svg>
      )}
    </button>
  );
}
