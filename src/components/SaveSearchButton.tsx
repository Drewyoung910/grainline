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
      const type = searchParams.get("type") || undefined;
      const ships = searchParams.get("ships");
      const rating = searchParams.get("rating");
      const lat = searchParams.get("lat");
      const lng = searchParams.get("lng");
      const radius = searchParams.get("radius");
      const sort = searchParams.get("sort") || undefined;
      const min = searchParams.get("min");
      const max = searchParams.get("max");
      const tags = searchParams.getAll("tag");
      const finiteNumber = (value: string | null) => {
        if (!value) return undefined;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
      };
      await fetch("/api/search/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q,
          category,
          type,
          shipsWithinDays: finiteNumber(ships),
          minRating: finiteNumber(rating),
          lat: finiteNumber(lat),
          lng: finiteNumber(lng),
          radiusMiles: finiteNumber(radius),
          sort,
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
