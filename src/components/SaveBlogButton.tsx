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
      disabled={loading}
      title={saved ? "Remove from saved" : "Save post"}
      aria-label={saved ? "Remove from saved" : "Save post"}
      className="inline-flex items-center justify-center p-1.5 transition-colors disabled:opacity-50"
    >
      {saved ? (
        // Filled bookmark — amber fill with drop shadow so it's visible on any background
        <svg
          width={18}
          height={18}
          viewBox="0 0 24 24"
          fill="#F59E0B"
          stroke="#D97706"
          strokeWidth={1}
          style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.4))" }}
        >
          <path d="M5 3a2 2 0 0 0-2 2v16l9-4 9 4V5a2 2 0 0 0-2-2H5z" />
        </svg>
      ) : (
        // Outline bookmark — white with drop shadow
        <svg
          width={18}
          height={18}
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.5))" }}
        >
          <path d="M5 3a2 2 0 0 0-2 2v16l9-4 9 4V5a2 2 0 0 0-2-2H5z" />
        </svg>
      )}
    </button>
  );
}
