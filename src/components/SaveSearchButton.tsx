"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";

export default function SaveSearchButton({ signedIn }: { signedIn: boolean }) {
  const searchParams = useSearchParams();
  const [state, setState] = React.useState<"idle" | "saving" | "saved">("idle");

  async function save() {
    if (!signedIn) {
      window.location.href = `/sign-in?redirect_url=${encodeURIComponent(window.location.href)}`;
      return;
    }
    setState("saving");
    try {
      const q = searchParams.get("q") || undefined;
      const category = searchParams.get("category") || undefined;
      const min = searchParams.get("min");
      const max = searchParams.get("max");
      const tags = searchParams.getAll("tag");
      await fetch("/api/search/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q,
          category,
          minPrice: min ? Math.round(Number(min) * 100) : undefined,
          maxPrice: max ? Math.round(Number(max) * 100) : undefined,
          tags,
        }),
      });
      setState("saved");
    } catch {
      setState("idle");
    }
  }

  return (
    <button
      onClick={save}
      disabled={state !== "idle"}
      className="rounded border px-3 py-1 text-sm hover:bg-neutral-50 disabled:opacity-60"
    >
      {state === "saving" ? "Saving…" : state === "saved" ? "Saved!" : "Save search"}
    </button>
  );
}
