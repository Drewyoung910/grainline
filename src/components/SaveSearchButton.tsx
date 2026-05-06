"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useToast } from "@/components/Toast";
import { signInPathForRedirect } from "@/lib/internalReturnUrl";
import { parseMoneyInputToCents } from "@/lib/money";

export default function SaveSearchButton({ signedIn }: { signedIn: boolean }) {
  const searchParams = useSearchParams();
  const [state, setState] = React.useState<"idle" | "saving" | "saved">("idle");
  const { toast } = useToast();

  async function save() {
    if (!signedIn) {
      window.location.href = signInPathForRedirect(window.location.pathname + window.location.search);
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
      const res = await fetch("/api/search/saved", {
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
          minPrice: parseMoneyInputToCents(min),
          maxPrice: parseMoneyInputToCents(max),
          tags,
        }),
      });
      if (!res.ok) {
        let message = "Couldn’t save this search.";
        try {
          const data = (await res.json()) as { error?: string };
          if (data.error) message = data.error;
        } catch {
          // keep generic message
        }
        toast(message, "error");
        setState("idle");
        return;
      }
      setState("saved");
    } catch {
      setState("idle");
      toast("Network error. Please try again.", "error");
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
