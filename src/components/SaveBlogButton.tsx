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
    const next = !saved;
    setSaved(next);
    setLoading(true);
    const method = next ? "POST" : "DELETE";
    try {
      const res = await fetch(`/api/blog/${slug}/save`, { method });
      if (res.status === 401) {
        setSaved(!next);
        router.push(`/sign-in?redirect_url=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      if (res.ok) {
        const data = (await res.json()) as { saved: boolean; error?: string };
        setSaved(data.saved);
        toast(data.saved ? "Post saved." : "Removed from saved posts.", "success");
        return;
      }
      setSaved(!next);
      let message = "Couldn’t update saved post.";
      try {
        const data = (await res.json()) as { error?: string };
        if (data.error) message = data.error;
      } catch {
        // keep generic message
      }
      toast(message, "error");
    } catch {
      setSaved(!next);
      toast("Network error. Please try again.", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={toggle}
      aria-busy={loading || undefined}
      aria-pressed={saved}
      title={saved ? "Remove from saved" : "Save post"}
      aria-label={saved ? "Remove from saved" : "Save post"}
      data-saved={saved ? "true" : "false"}
      onPointerUp={(event) => event.currentTarget.blur()}
      className="listing-save-control group/blog-save relative inline-flex h-11 w-11 transform-gpu items-center justify-center rounded-full transition-[opacity,translate,scale] duration-200 ease-out focus-visible:outline-none"
    >
      <span
        aria-hidden="true"
        className="absolute h-[34px] w-[34px] rounded-full bg-[#2C1F1A]/62 shadow-[0_6px_18px_-8px_rgba(20,13,10,0.9),0_0_0_1px_rgba(255,255,255,0.3)] backdrop-blur-md transition-[background-color,scale,box-shadow] duration-180 ease-out group-hover/blog-save:scale-[1.06] group-hover/blog-save:bg-[#2C1F1A]/74 group-hover/blog-save:shadow-[0_8px_22px_-9px_rgba(20,13,10,0.95),0_0_0_1px_rgba(255,255,255,0.38)] motion-safe:group-active/blog-save:scale-[0.94] group-focus-visible/blog-save:ring-2 group-focus-visible/blog-save:ring-white group-focus-visible/blog-save:ring-offset-2 group-focus-visible/blog-save:ring-offset-[#2C1F1A]"
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
          stroke="#FBF8F3"
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
